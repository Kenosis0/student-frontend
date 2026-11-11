/* =========================================================
   js/app.js — Roster Controller, Views, Filters & Form Logic
   ========================================================= */

const SECTION_ORDER = [
  'BSIT-3A',
  'BSIT-3B',
  'BSCS-2A',
  'BSCS-2B',
  'BSCpE-4A',
  'BSCpE-4C',
  'BSIS-3A'
];

let cachedRecords = [];
let activeSection = 'ALL';
let viewMode = 'table'; // 'table' | 'compact'
let sortAscending = true;
let selectedAssistStatus = 'Present';
let selectedEditStatus = 'Present';

/* =========================================================
   UTILITIES & DATA UNPACKING
   ========================================================= */
function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

function setConnectionStatus(online) {
  const indicator = document.getElementById('connectionStatus');
  const label = document.getElementById('statusText');
  indicator.className = `status-indicator ${online ? 'online' : 'offline'}`;
  label.textContent = online ? 'Atlas Connected' : 'API Unreachable';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function padIndex(num) {
  if (num === null || num === undefined || isNaN(Number(num))) return '--';
  return String(Number(num)).padStart(2, '0');
}

function classifyStatus(statusStr) {
  const s = String(statusStr || '').trim().toLowerCase();
  if (s === 'present') return 'present';
  if (s === 'late') return 'late';
  if (s === 'absent') return 'absent';
  return '';
}

/**
 * Unpack structured student documents OR gracefully normalize manual { title, content } records.
 */
function normalizeRecord(raw, fallbackIdx) {
  const isRosterSource = raw.source === 'daily_attendance' || Boolean(raw.roster_index !== undefined && raw.roster_index !== null);
  const hasStructuredRoster = Boolean(raw.student_name && Array.isArray(raw.attendance_log) && isRosterSource);

  if (hasStructuredRoster) {
    return {
      _id: raw._id,
      isRoster: true,
      rosterIndex: raw.roster_index ?? fallbackIdx,
      studentName: raw.student_name,
      studentNumber: raw.student_number || '--',
      subject: raw.subject || 'Laboratory Coursework',
      section: raw.section || raw.section_code || 'Unassigned',
      sectionCode: raw.section_code || (raw.section ? String(raw.section).split(' ')[0] : 'OTHER'),
      attendanceLog: raw.attendance_log,
      rawTitle: raw.title || raw.student_name,
      rawContent: raw.content || '',
      createdAt: raw.createdAt || null
    };
  }

  // Gracefully unpack manually created { title, content } or structured portal records
  const titleStr = String(raw.title || raw.student_name || 'Untitled Entry').trim();
  const contentStr = String(raw.content || '').trim();

  let parsedSubject = raw.subject || 'Manual Portal Entry';
  let parsedSection = raw.section || 'PORTAL LOG';
  let parsedSectionCode = raw.section_code || 'PORTAL';
  const syntheticLogs = Array.isArray(raw.attendance_log) ? [...raw.attendance_log] : [];

  const pipeParts = contentStr.split('|').map(p => p.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    if (!raw.subject) parsedSubject = pipeParts[0];
    const secCandidate = pipeParts[1];
    if (/^(BSIT|BSCS|BSCpE|BSIS)/i.test(secCandidate)) {
      if (!raw.section) parsedSection = secCandidate;
      if (!raw.section_code) parsedSectionCode = secCandidate.split(/\s+/)[0];
    }
  }

  if (syntheticLogs.length === 0) {
    const dateStatusRegex = /(\d{4}-\d{2}-\d{2})\s*\(?(Present|Late|Absent)\)?/gi;
    let match;
    while ((match = dateStatusRegex.exec(contentStr)) !== null) {
      syntheticLogs.push({
        date: match[1],
        status: match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()
      });
    }
  }

  if (parsedSectionCode === 'PORTAL') {
    const titleSecMatch = titleStr.match(/\((BS(?:IT|CS|CpE|IS)-[0-9][A-Z])\)/i);
    if (titleSecMatch) {
      parsedSectionCode = titleSecMatch[1];
      if (parsedSection === 'PORTAL LOG') parsedSection = titleSecMatch[1];
    }
  }

  const cleanDisplayName = raw.student_name
    ? String(raw.student_name).trim()
    : (titleStr.replace(/\s*\((BS(?:IT|CS|CpE|IS)-[0-9][A-Z])\)\s*$/i, '').trim() || titleStr);
  const createdDate = raw.createdAt ? new Date(raw.createdAt) : null;
  const subId = createdDate && !isNaN(createdDate.getTime())
    ? `LOG-${createdDate.toISOString().slice(5, 10).replace('-', '')}`
    : 'PORTAL-REC';

  return {
    _id: raw._id,
    isRoster: false,
    rosterIndex: raw.roster_index ?? null,
    studentName: cleanDisplayName,
    studentNumber: raw.student_number || subId,
    subject: parsedSubject,
    section: parsedSection,
    sectionCode: parsedSectionCode,
    attendanceLog: syntheticLogs,
    plainContent: syntheticLogs.length === 0 ? contentStr : '',
    rawTitle: titleStr,
    rawContent: contentStr,
    createdAt: raw.createdAt || null
  };
}

function renderLogPillHtml(entry) {
  const cls = classifyStatus(entry.status);
  const safeDate = escapeHtml(entry.date || '----');
  const safeStatus = escapeHtml(entry.status || 'Logged');
  return `<span class="log-pill ${cls}"><span class="status-bullet" aria-hidden="true"></span>${safeDate} &middot; ${safeStatus}</span>`;
}

/* =========================================================
   DYNAMIC SECTION FILTER PILLS & KPI BAR
   ========================================================= */
function buildSectionFilterTabs(normalizedList) {
  const bar = document.getElementById('sectionFilterBar');
  const counts = new Map();

  normalizedList.forEach(item => {
    const code = item.sectionCode || 'PORTAL';
    counts.set(code, (counts.get(code) || 0) + 1);
  });

  const orderedCodes = [];
  SECTION_ORDER.forEach(code => {
    if (counts.has(code)) orderedCodes.push(code);
  });
  for (const code of counts.keys()) {
    if (!orderedCodes.includes(code)) orderedCodes.push(code);
  }

  if (activeSection !== 'ALL' && !counts.has(activeSection)) {
    activeSection = 'ALL';
  }

  let html = `
    <button type="button" class="section-pill ${activeSection === 'ALL' ? 'active' : ''}" data-section="ALL">
      <span>All Sections</span>
      <span class="pill-count">(${normalizedList.length})</span>
    </button>
  `;

  orderedCodes.forEach(code => {
    const count = counts.get(code) || 0;
    const label = code === 'PORTAL' ? 'Portal Logs' : code;
    const isActive = activeSection === code ? 'active' : '';
    html += `
      <button type="button" class="section-pill ${isActive}" data-section="${escapeHtml(code)}">
        <span>${escapeHtml(label)}</span>
        <span class="pill-count">(${count})</span>
      </button>
    `;
  });

  bar.innerHTML = html;

  bar.querySelectorAll('.section-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSection = btn.dataset.section;
      buildSectionFilterTabs(normalizedList);
      refreshRosterDisplay();
    });
  });
}

function updateKpiMetrics(filteredList, allList) {
  let presentSessions = 0;
  let lateSessions = 0;
  let absentSessions = 0;
  let totalSessions = 0;
  const activeSectionSet = new Set();
  const totalSectionSet = new Set();

  allList.forEach(item => {
    if (item.sectionCode && item.sectionCode !== 'PORTAL') {
      totalSectionSet.add(item.sectionCode);
    }
  });

  filteredList.forEach(item => {
    if (item.sectionCode && item.sectionCode !== 'PORTAL') {
      activeSectionSet.add(item.sectionCode);
    }
    item.attendanceLog.forEach(entry => {
      totalSessions++;
      const st = classifyStatus(entry.status);
      if (st === 'present') presentSessions++;
      else if (st === 'late') lateSessions++;
      else if (st === 'absent') absentSessions++;
    });
  });

  const presentRate = totalSessions > 0
    ? ((presentSessions / totalSessions) * 100).toFixed(1)
    : '0.0';

  document.getElementById('headlineCount').textContent = `(${allList.length})`;
  document.getElementById('kpiTotalStudents').textContent = String(filteredList.length);
  document.getElementById('kpiTotalSub').textContent = activeSection === 'ALL'
    ? `of ${allList.length} enrolled records`
    : `filtered in ${activeSection}`;

  document.getElementById('kpiPresentRate').textContent = `${presentRate}%`;
  document.getElementById('kpiPresentSub').textContent = `${presentSessions} / ${totalSessions} sessions`;

  document.getElementById('kpiLateCount').textContent = String(lateSessions);
  document.getElementById('kpiAbsentSub').textContent = `${absentSessions} absent logs`;

  document.getElementById('kpiActiveSections').textContent = String(
    activeSection === 'ALL' ? totalSectionSet.size : activeSectionSet.size
  );
  document.getElementById('kpiSectionsSub').textContent = activeSection === 'ALL'
    ? 'BSIT • BSCS • BSCpE • BSIS'
    : `1 of ${totalSectionSet.size} cohorts active`;
}

/* =========================================================
   QUICK-ASSIST STUDENT DROPDOWN & AUTO-POPULATION
   ========================================================= */
function populateAssistRosterDropdown(normalizedList) {
  const sel = document.getElementById('assistStudentSelect');
  const prev = sel.value;
  const rosterItems = normalizedList
    .filter(item => item.isRoster)
    .sort((a, b) => (a.rosterIndex || 0) - (b.rosterIndex || 0));

  let optionsHtml = '<option value="">-- Custom / Manual Entry --</option>';
  rosterItems.forEach(st => {
    const val = `${st.studentName}||${st.sectionCode}||${st.section}||${st.subject}||${st.studentNumber}`;
    optionsHtml += `<option value="${escapeHtml(val)}">${padIndex(st.rosterIndex)} — ${escapeHtml(st.studentName)} (${escapeHtml(st.sectionCode)})</option>`;
  });

  sel.innerHTML = optionsHtml;
  if (prev) sel.value = prev;
}

function syncAssistFieldsToForm(sourceTrigger) {
  const studentVal = document.getElementById('assistStudentSelect').value;
  const sectionSel = document.getElementById('assistSectionSelect');
  const subjectInput = document.getElementById('assistSubjectInput');
  const selectedOption = sectionSel.options[sectionSel.selectedIndex];
  const dateVal = document.getElementById('assistDateInput').value || new Date().toISOString().split('T')[0];

  if (sourceTrigger === 'section' && selectedOption && selectedOption.dataset.subject) {
    subjectInput.value = selectedOption.dataset.subject;
  }

  if (studentVal && sourceTrigger === 'student') {
    const [studentName, sectionCode, fullSection, subject] = studentVal.split('||');
    for (let i = 0; i < sectionSel.options.length; i++) {
      if (sectionSel.options[i].dataset.code === sectionCode) {
        sectionSel.selectedIndex = i;
        break;
      }
    }
    if (subject) subjectInput.value = subject;
    document.getElementById('title').value = `${studentName} (${sectionCode})`;
    document.getElementById('content').value = `${subjectInput.value.trim() || subject} | ${fullSection} | Latest: ${dateVal} (${selectedAssistStatus})`;
    return;
  }

  const secFull = selectedOption ? selectedOption.value : 'BSIT-3A 9332-AY226';
  const secCode = selectedOption ? selectedOption.dataset.code : 'BSIT-3A';
  const subj = (subjectInput && subjectInput.value.trim())
    || (selectedOption ? selectedOption.dataset.subject : 'Laboratory Session');

  if (studentVal) {
    const [studentName] = studentVal.split('||');
    document.getElementById('title').value = `${studentName} (${secCode})`;
  } else {
    const currentTitle = document.getElementById('title').value.trim();
    if (currentTitle && sourceTrigger !== 'title') {
      const baseName = currentTitle.replace(/\s*\((BS(?:IT|CS|CpE|IS)-[0-9][A-Z])\)\s*$/i, '').trim();
      document.getElementById('title').value = `${baseName} (${secCode})`;
    }
  }

  document.getElementById('content').value = `${subj} | ${secFull} | Latest: ${dateVal} (${selectedAssistStatus})`;
}

/* =========================================================
   FILTERING, SORTING & MULTI-VIEW RENDERING
   ========================================================= */
function getNormalizedRecords() {
  return cachedRecords.map((r, idx) => normalizeRecord(r, idx + 1));
}

function filterAndSortNormalized(allNormalized) {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  let list = allNormalized;

  if (activeSection !== 'ALL') {
    list = list.filter(item => item.sectionCode === activeSection);
  }

  if (query) {
    list = list.filter(item => {
      const logText = item.attendanceLog.map(l => `${l.date} ${l.status}`).join(' ').toLowerCase();
      return (
        item.studentName.toLowerCase().includes(query) ||
        item.studentNumber.toLowerCase().includes(query) ||
        item.subject.toLowerCase().includes(query) ||
        item.section.toLowerCase().includes(query) ||
        item.sectionCode.toLowerCase().includes(query) ||
        item.rawContent.toLowerCase().includes(query) ||
        logText.includes(query)
      );
    });
  }

  list = list.slice().sort((a, b) => {
    if (a.isRoster !== b.isRoster) {
      return a.isRoster ? 1 : -1;
    }
    if (a.isRoster && b.isRoster) {
      const idxA = a.rosterIndex ?? 9999;
      const idxB = b.rosterIndex ?? 9999;
      return sortAscending ? idxA - idxB : idxB - idxA;
    }
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });

  return list;
}

function setEditModalStatus(statusVal) {
  selectedEditStatus = statusVal || 'Present';
  document.querySelectorAll('#editStatusGroup .status-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status.toLowerCase() === selectedEditStatus.toLowerCase());
  });
}

function syncEditModalFields() {
  const studentName = document.getElementById('editStudentName').value.trim();
  const subject = document.getElementById('editSubject').value.trim();
  const section = document.getElementById('editSection').value.trim();
  const dateVal = document.getElementById('editDate').value || new Date().toISOString().split('T')[0];
  const secCode = section ? section.split(/\s+/)[0] : '';

  if (studentName) {
    document.getElementById('editTitle').value = `${studentName}${secCode ? ` (${secCode})` : ''}`;
  }
  document.getElementById('editContent').value = [
    subject || 'Laboratory Coursework',
    section || 'Unassigned',
    `Latest: ${dateVal} (${selectedEditStatus})`
  ].join(' | ');
}

function openEditModal(item) {
  const modal = document.getElementById('editRecordModal');
  const latestLog = item.attendanceLog && item.attendanceLog.length > 0
    ? item.attendanceLog[item.attendanceLog.length - 1]
    : null;

  const initialDate = (latestLog && latestLog.date) || new Date().toISOString().split('T')[0];
  const initialStatus = (latestLog && latestLog.status) || 'Present';

  document.getElementById('editRecordId').value = item._id || '';
  document.getElementById('editRecordIdDisplay').textContent = `ID: ${item._id || '--'}`;
  document.getElementById('editStudentName').value = item.studentName || '';
  document.getElementById('editSubject').value = item.subject || '';
  document.getElementById('editSection').value = item.section || '';
  document.getElementById('editDate').value = initialDate;
  setEditModalStatus(initialStatus);

  document.getElementById('editTitle').value = item.rawTitle || `${item.studentName} (${item.sectionCode})`;
  document.getElementById('editContent').value = item.rawContent || [
    item.subject,
    item.section,
    `Latest: ${initialDate} (${initialStatus})`
  ].filter(Boolean).join(' | ');

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('editStudentName').focus();
}

function closeEditModal() {
  const modal = document.getElementById('editRecordModal');
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function attachRecordActions(rootEl, item) {
  const editBtn = rootEl.querySelector('.edit-record-btn');
  if (editBtn && item._id) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(item);
    });
  }

  const copyBtn = rootEl.querySelector('.copy-record-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const summary = item.attendanceLog.length > 0
        ? `${item.studentName} (${item.studentNumber}) — ${item.section} — ${item.attendanceLog.map(l => `${l.date}: ${l.status}`).join(', ')}`
        : `${item.rawTitle}: ${item.rawContent}`;
      navigator.clipboard.writeText(summary);
      showToast(`Copied ${item.studentName}`);
    });
  }

  const deleteBtn = rootEl.querySelector('.delete-record-btn');
  if (deleteBtn && item._id) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = window.confirm(
        `Are you sure you want to delete the attendance record for "${item.studentName}"?`
      );
      if (!confirmed) return;

      try {
        await deleteRosterRecord(item._id);
        showToast('Attendance record deleted from MongoDB Atlas');
        await loadRecords();
      } catch (err) {
        showToast('Failed to delete record', true);
      }
    });
  }
}

function renderTableView(records, container) {
  const sortArrow = sortAscending ? '&#8593;' : '&#8595;';
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';

  const table = document.createElement('table');
  table.className = 'roster-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="sortable" id="thSortIndex" title="Toggle Roster Order"># ${sortArrow}</th>
        <th>STUDENT NAME</th>
        <th>SUBJECT</th>
        <th>SECTION</th>
        <th>SESSION ATTENDANCE LOG (YYYY-MM-DD) &amp; ACTIONS</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  records.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'card roster-row';

    const indexDisplay = item.isRoster ? padIndex(item.rosterIndex) : 'NEW';
    const logsHtml = item.attendanceLog.length > 0
      ? item.attendanceLog.map(renderLogPillHtml).join('')
      : `<span class="manual-content-note">${escapeHtml(item.plainContent || item.rawContent)}</span>`;

    tr.innerHTML = `
      <td class="col-index">${escapeHtml(indexDisplay)}</td>
      <td class="col-student">
        <div class="student-primary">${escapeHtml(item.studentName)}</div>
        <div class="student-id-sub">
          <span>${escapeHtml(item.studentNumber)}</span>
        </div>
      </td>
      <td class="col-subject">${escapeHtml(item.subject)}</td>
      <td class="col-section">
        <span class="section-code-badge">${escapeHtml(item.section)}</span>
      </td>
      <td class="col-logs">
        <div class="logs-wrap">
          <div class="log-pills-list">${logsHtml}</div>
          <div class="row-actions">
            ${item._id ? `<button type="button" class="row-icon-btn edit-record-btn" data-id="${escapeHtml(item._id)}" title="Edit attendance record (PUT /api)">Edit</button>` : ''}
            <button type="button" class="row-icon-btn copy-record-btn" title="Copy record">Copy</button>
            ${item._id ? `<button type="button" class="row-icon-btn danger delete-record-btn" data-id="${escapeHtml(item._id)}" title="Delete attendance record (DELETE /api)">Del</button>` : ''}
          </div>
        </div>
      </td>
    `;

    attachRecordActions(tr, item);
    tbody.appendChild(tr);
  });

  wrapper.appendChild(table);
  container.appendChild(wrapper);

  const sortHeader = table.querySelector('#thSortIndex');
  if (sortHeader) {
    sortHeader.addEventListener('click', () => {
      sortAscending = !sortAscending;
      refreshRosterDisplay();
    });
  }
}

function renderCompactView(records, container) {
  const listEl = document.createElement('div');
  listEl.className = 'compact-list';

  records.forEach(item => {
    const row = document.createElement('div');
    row.className = 'card compact-row';

    const indexDisplay = item.isRoster ? padIndex(item.rosterIndex) : 'NEW';
    const latestEntry = item.attendanceLog.length > 0
      ? item.attendanceLog[item.attendanceLog.length - 1]
      : null;

    const latestHtml = latestEntry
      ? renderLogPillHtml(latestEntry)
      : `<span class="manual-content-note">${escapeHtml(item.plainContent || item.rawContent)}</span>`;

    const historyHtml = item.attendanceLog.length > 0
      ? item.attendanceLog.map(renderLogPillHtml).join('')
      : `<span class="manual-content-note">${escapeHtml(item.plainContent || item.rawContent)}</span>`;

    row.innerHTML = `
      <div class="compact-main" title="Click to inspect full session attendance history">
        <span class="compact-idx">${escapeHtml(indexDisplay)}</span>
        <span class="compact-id">${escapeHtml(item.studentNumber)}</span>
        <span class="compact-name">${escapeHtml(item.studentName)}</span>
        <span class="compact-subject-col">${escapeHtml(item.subject)}</span>
        <span class="compact-section-col">
          <span class="section-code-badge">${escapeHtml(item.section)}</span>
        </span>
        <div class="compact-latest">${latestHtml}</div>
        <button type="button" class="chevron-btn" aria-label="Expand session history">&#9656;</button>
      </div>
      <div class="compact-drawer">
        <div class="log-pills-list">
          <span class="compact-drawer-label">${escapeHtml(item.subject)} &bull; All Sessions:</span>
          ${historyHtml}
        </div>
        <div class="row-actions row-actions-visible">
          ${item._id ? `<button type="button" class="row-icon-btn edit-record-btn" data-id="${escapeHtml(item._id)}">Edit</button>` : ''}
          <button type="button" class="row-icon-btn copy-record-btn">Copy</button>
          ${item._id ? `<button type="button" class="row-icon-btn danger delete-record-btn" data-id="${escapeHtml(item._id)}">Delete</button>` : ''}
        </div>
      </div>
    `;

    row.querySelector('.compact-main').addEventListener('click', () => {
      row.classList.toggle('expanded');
    });

    attachRecordActions(row, item);
    listEl.appendChild(row);
  });

  container.appendChild(listEl);
}

function refreshRosterDisplay() {
  const container = document.getElementById('recordsContainer');
  const allNormalized = getNormalizedRecords();
  const filtered = filterAndSortNormalized(allNormalized);

  updateKpiMetrics(filtered, allNormalized);
  document.getElementById('footerSummaryText').textContent =
    `Showing ${filtered.length} of ${allNormalized.length} records (${activeSection === 'ALL' ? 'All Sections' : activeSection})`;

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="state-box">No matching attendance records found for the current filter.</div>';
    return;
  }

  if (viewMode === 'table') {
    renderTableView(filtered, container);
  } else {
    renderCompactView(filtered, container);
  }
}

function renderLoadingSkeletons() {
  const container = document.getElementById('recordsContainer');
  container.innerHTML = Array.from({ length: 6 }).map(() => `
    <div class="skeleton-row" aria-hidden="true">
      <div class="skel-bar skel-idx"></div>
      <div class="skel-bar skel-name"></div>
      <div class="skel-bar skel-subj"></div>
      <div class="skel-bar skel-sec"></div>
      <div class="skel-bar skel-logs"></div>
    </div>
  `).join('');
}

/* =========================================================
   REQUIRED LAB SPECIFICATION FUNCTIONS: loadRecords & #dataForm
   ========================================================= */
async function loadRecords() {
  renderLoadingSkeletons();
  try {
    cachedRecords = await fetchRosterRecords();
    setConnectionStatus(true);

    const allNormalized = getNormalizedRecords();
    buildSectionFilterTabs(allNormalized);
    populateAssistRosterDropdown(allNormalized);
    refreshRosterDisplay();
  } catch (error) {
    setConnectionStatus(false);
    document.getElementById('recordsContainer').innerHTML =
      '<div class="state-box">Error loading records. Verify your Vercel API URL and MongoDB Atlas network access.</div>';
  }
}

/* =========================================================
   DOM INITIALIZATION & EVENT BINDINGS
   ========================================================= */
function initApp() {
  document.getElementById('footerEndpointText').textContent = `Endpoint: ${VERCEL_API_URL}`;

  // Required #dataForm Submission Handler (POST /api - Create)
  document.getElementById('dataForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('title').value.trim();
    const content = document.getElementById('content').value.trim();
    const submitBtn = document.getElementById('submitBtn');

    if (!title || !content) return;

    const sectionSel = document.getElementById('assistSectionSelect');
    const selectedOption = sectionSel.options[sectionSel.selectedIndex];
    const section = selectedOption ? selectedOption.value : '';
    const section_code = selectedOption ? selectedOption.dataset.code : '';
    const subject = document.getElementById('assistSubjectInput').value.trim()
      || (selectedOption ? selectedOption.dataset.subject : '');
    const date = document.getElementById('assistDateInput').value || new Date().toISOString().split('T')[0];
    const student_name = title.replace(/\s*\((BS(?:IT|CS|CpE|IS)-[0-9][A-Z])\)\s*$/i, '').trim() || title;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Committing...';

    try {
      await createRosterRecord({
        title,
        content,
        student_name,
        subject,
        section,
        section_code,
        date,
        status: selectedAssistStatus
      });
      document.getElementById('dataForm').reset();
      document.getElementById('assistStudentSelect').value = '';
      if (selectedOption && selectedOption.dataset.subject) {
        document.getElementById('assistSubjectInput').value = selectedOption.dataset.subject;
      }
      showToast('Attendance record committed to MongoDB Atlas');
      await loadRecords();
    } catch (error) {
      showToast('Failed to submit record to API', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Commit Record';
    }
  });

  // Edit Attendance Record Modal Submission Handler (PUT /api - Update)
  document.getElementById('editRecordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const recordId = document.getElementById('editRecordId').value.trim();
    const student_name = document.getElementById('editStudentName').value.trim();
    const subject = document.getElementById('editSubject').value.trim();
    const section = document.getElementById('editSection').value.trim();
    const section_code = section ? section.split(/\s+/)[0] : '';
    const date = document.getElementById('editDate').value.trim();
    const title = document.getElementById('editTitle').value.trim();
    const content = document.getElementById('editContent').value.trim();
    const saveEditBtn = document.getElementById('saveEditBtn');

    if (!recordId || !title || !content) return;

    saveEditBtn.disabled = true;
    saveEditBtn.textContent = 'Saving...';

    try {
      await updateRosterRecord(recordId, {
        title,
        content,
        student_name,
        subject,
        section,
        section_code,
        date,
        status: selectedEditStatus
      });
      closeEditModal();
      showToast('Attendance record updated in MongoDB Atlas');
      await loadRecords();
    } catch (error) {
      showToast('Failed to update attendance record', true);
    } finally {
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = 'Save Changes';
    }
  });

  // Edit Modal Input Auto-Sync & Controls
  ['editStudentName', 'editSubject', 'editSection', 'editDate'].forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('input', syncEditModalFields);
    document.getElementById(fieldId).addEventListener('change', syncEditModalFields);
  });

  document.querySelectorAll('#editStatusGroup .status-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setEditModalStatus(btn.dataset.status);
      syncEditModalFields();
    });
  });

  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
  document.getElementById('editRecordModal').addEventListener('click', (e) => {
    if (e.target.id === 'editRecordModal') closeEditModal();
  });

  // Collapsible Command Drawer
  const commandDrawer = document.getElementById('commandDrawer');
  const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');

  function setDrawerOpen(open) {
    commandDrawer.classList.toggle('open', open);
    toggleDrawerBtn.classList.toggle('drawer-open', open);
    toggleDrawerBtn.setAttribute('aria-expanded', String(open));
    document.getElementById('drawerBtnIcon').textContent = open ? '−' : '+';
    if (open) {
      syncAssistFieldsToForm('init');
      document.getElementById('title').focus();
    }
  }

  toggleDrawerBtn.addEventListener('click', () => {
    setDrawerOpen(!commandDrawer.classList.contains('open'));
  });

  document.getElementById('closeDrawerBtn').addEventListener('click', () => {
    setDrawerOpen(false);
  });

  // Quick-Assist Form Controls
  document.getElementById('assistDateInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('assistStudentSelect').addEventListener('change', () => syncAssistFieldsToForm('student'));
  document.getElementById('assistSubjectInput').addEventListener('input', () => syncAssistFieldsToForm('subject'));
  document.getElementById('assistSectionSelect').addEventListener('change', () => syncAssistFieldsToForm('section'));
  document.getElementById('assistDateInput').addEventListener('change', () => syncAssistFieldsToForm('date'));
  document.getElementById('title').addEventListener('input', () => {
    if (!document.getElementById('content').value.trim()) {
      syncAssistFieldsToForm('title');
    }
  });

  document.querySelectorAll('#assistStatusGroup .status-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#assistStatusGroup .status-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedAssistStatus = btn.dataset.status;
      syncAssistFieldsToForm('status');
    });
  });

  // Multi-View Switcher (Table vs. Compact)
  document.getElementById('viewTableBtn').addEventListener('click', () => {
    viewMode = 'table';
    document.getElementById('viewTableBtn').classList.add('active');
    document.getElementById('viewCompactBtn').classList.remove('active');
    refreshRosterDisplay();
  });

  document.getElementById('viewCompactBtn').addEventListener('click', () => {
    viewMode = 'compact';
    document.getElementById('viewCompactBtn').classList.add('active');
    document.getElementById('viewTableBtn').classList.remove('active');
    refreshRosterDisplay();
  });

  // Live Search Input + "/" Shortcut
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', refreshRosterDisplay);

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Escape') {
      document.getElementById('apiModal').classList.remove('active');
      closeEditModal();
      if (commandDrawer.classList.contains('open')) setDrawerOpen(false);
    }
  });

  // Sync Button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadRecords();
    showToast('Synchronized with MongoDB Atlas');
  });

  // Theme Switcher
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const isDark = theme === 'dark';
    document.getElementById('themeIcon').innerHTML = isDark ? '&#9728;' : '&#9790;';
    document.getElementById('themeLabel').textContent = isDark ? 'Light' : 'Dark';
  }

  const savedTheme = localStorage.getItem('PORTAL_THEME') || 'light';
  applyTheme(savedTheme);

  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('PORTAL_THEME', next);
    applyTheme(next);
  });

  // Endpoint Config Modal
  const apiModal = document.getElementById('apiModal');
  function openApiModal() {
    document.getElementById('customApiInput').value = VERCEL_API_URL;
    apiModal.classList.add('active');
  }

  document.getElementById('apiConfigBtn').addEventListener('click', openApiModal);
  document.getElementById('endpointBadgeBtn').addEventListener('click', openApiModal);
  document.getElementById('closeModalBtn').addEventListener('click', () => apiModal.classList.remove('active'));
  document.getElementById('resetApiBtn').addEventListener('click', resetCustomEndpointUrl);
  document.getElementById('saveApiBtn').addEventListener('click', () => {
    saveCustomEndpointUrl(document.getElementById('customApiInput').value);
  });

  // Initial Database Fetch
  loadRecords();
}

initApp();

/* =========================================================
   js/api.js — Vercel Serverless API Client & Endpoint Config
   ========================================================= */

const CUSTOM_API_STORAGE_KEY = 'CUSTOM_VERCEL_API_URL';
const LEGACY_PLACEHOLDER_URL = 'https://student-api-backend.vercel.app/api';

// Clear legacy unconfigured default URL if previously cached
if (localStorage.getItem(CUSTOM_API_STORAGE_KEY) === LEGACY_PLACEHOLDER_URL) {
  localStorage.removeItem(CUSTOM_API_STORAGE_KEY);
}

// Required Lab Constant: Vercel Serverless API URL
const DEFAULT_VERCEL_API_URL = 'https://student-api-backend-two.vercel.app/api';
const VERCEL_API_URL = localStorage.getItem(CUSTOM_API_STORAGE_KEY) || DEFAULT_VERCEL_API_URL;

/**
 * Fetch all attendance & portal records from the Vercel Serverless API (GET /api).
 * @returns {Promise<Array<Object>>}
 */
async function fetchRosterRecords() {
  const response = await fetch(VERCEL_API_URL);
  if (!response.ok) {
    throw new Error(`API returned status ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Create and persist a new record to MongoDB Atlas (POST /api).
 * @param {{ title: string, content: string }} payload
 * @returns {Promise<Object>}
 */
async function createRosterRecord(payload) {
  const response = await fetch(VERCEL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to submit record (status ${response.status})`);
  }

  return response.json();
}

/**
 * Update an existing attendance or portal record in MongoDB Atlas (PUT /api?id=...).
 * @param {string} recordId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
async function updateRosterRecord(recordId, payload) {
  const response = await fetch(`${VERCEL_API_URL}?id=${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: recordId, ...payload })
  });

  if (!response.ok) {
    throw new Error(`Failed to update record (status ${response.status})`);
  }

  return response.json();
}

/**
 * Delete an attendance or portal record by MongoDB ObjectId (DELETE /api?id=...).
 * @param {string} recordId
 * @returns {Promise<Object>}
 */
async function deleteRosterRecord(recordId) {
  const response = await fetch(`${VERCEL_API_URL}?id=${encodeURIComponent(recordId)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Failed to delete record (status ${response.status})`);
  }

  return response.json();
}

/**
 * Persist a custom API endpoint override and reload the portal.
 * @param {string} url
 */
function saveCustomEndpointUrl(url) {
  const trimmed = String(url || '').trim();
  if (trimmed) {
    localStorage.setItem(CUSTOM_API_STORAGE_KEY, trimmed);
    window.location.reload();
  }
}

/**
 * Reset API endpoint override back to the default production Vercel URL.
 */
function resetCustomEndpointUrl() {
  localStorage.removeItem(CUSTOM_API_STORAGE_KEY);
  window.location.reload();
}

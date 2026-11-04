/* =========================================================
   js/canvas.js — Interactive Mouse-Flow Vector Dot-Matrix
   ========================================================= */

function initInteractiveCanvas() {
  const canvas = document.getElementById('flowCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;

  const pointer = {
    x: -9999,
    y: -9999,
    tx: -9999,
    ty: -9999,
    active: false
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('mousemove', (e) => {
    pointer.tx = e.clientX;
    pointer.ty = e.clientY;
    if (!pointer.active) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    pointer.active = false;
  }, { passive: true });

  resize();

  function renderFrame(ts) {
    const t = ts * 0.0012;
    ctx.clearRect(0, 0, width, height);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    if (pointer.active) {
      pointer.x += (pointer.tx - pointer.x) * 0.11;
      pointer.y += (pointer.ty - pointer.y) * 0.11;
    } else {
      pointer.x += (-9999 - pointer.x) * 0.02;
      pointer.y += (-9999 - pointer.y) * 0.02;
    }

    // Soft radial spotlight glow following cursor
    if (pointer.active) {
      const grad = ctx.createRadialGradient(pointer.x, pointer.y, 8, pointer.x, pointer.y, 320);
      if (isDark) {
        grad.addColorStop(0, 'rgba(52, 211, 153, 0.09)');
        grad.addColorStop(0.45, 'rgba(56, 189, 248, 0.035)');
        grad.addColorStop(1, 'rgba(9, 11, 16, 0)');
      } else {
        grad.addColorStop(0, 'rgba(16, 185, 129, 0.09)');
        grad.addColorStop(0.5, 'rgba(15, 23, 42, 0.025)');
        grad.addColorStop(1, 'rgba(248, 250, 252, 0)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Vector dot-matrix with magnetic ripple displacement
    const spacing = 28;
    const influenceRadius = 195;
    const influenceSq = influenceRadius * influenceRadius;
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;

    const baseRGB = isDark ? '148, 163, 184' : '71, 85, 105';
    const activeRGB = isDark ? '52, 211, 153' : '5, 150, 105';

    for (let r = 0; r < rows; r++) {
      const baseY = r * spacing;
      for (let c = 0; c < cols; c++) {
        const baseX = c * spacing;

        // Subtle ambient flow drift
        const ambientAngle = Math.sin(baseX * 0.004 + t) + Math.cos(baseY * 0.004 - t * 0.8);
        let drawX = baseX + Math.cos(ambientAngle) * 1.1;
        let drawY = baseY + Math.sin(ambientAngle) * 1.1;

        const dx = drawX - pointer.x;
        const dy = drawY - pointer.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < influenceSq) {
          const dist = Math.sqrt(distSq) || 0.001;
          const factor = 1 - dist / influenceRadius;
          const wave = Math.sin(dist * 0.055 - ts * 0.005) * 6.5 * factor;
          const push = factor * factor * 9;
          drawX += (dx / dist) * (push + wave);
          drawY += (dy / dist) * (push + wave);

          const alpha = (isDark ? 0.22 : 0.20) + factor * 0.55;
          const radius = 1.05 + factor * 1.35;

          ctx.fillStyle = `rgba(${activeRGB}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = isDark ? `rgba(${baseRGB}, 0.14)` : `rgba(${baseRGB}, 0.17)`;
          ctx.fillRect(drawX - 0.85, drawY - 0.85, 1.7, 1.7);
        }
      }
    }

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);
}

initInteractiveCanvas();

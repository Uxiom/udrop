(function (global) {
  const THEMES = {
    obsidian: {
      cardBg: '#09090B',
      cardFg: '#FAFAFA',
      qrBg: '#FAFAFA',
      qrFg: '#09090B',
      sub: '#A1A1AA',
      border: 'rgba(255, 255, 255, 0.14)'
    },
    titanium: {
      cardBg: '#27272A',
      cardFg: '#FAFAFA',
      qrBg: '#FAFAFA',
      qrFg: '#09090B',
      sub: '#D4D4D8',
      border: 'rgba(255, 255, 255, 0.18)'
    },
    paper: {
      cardBg: '#FAFAFA',
      cardFg: '#09090B',
      qrBg: '#09090B',
      qrFg: '#FAFAFA',
      sub: '#52525B',
      border: 'rgba(9, 9, 11, 0.16)'
    }
  };

  function hashFloat(r, c, salt) {
    let x = Math.sin((r + 1) * 12.9898 + (c + 1) * 78.233 + salt * 43.123) * 43758.5453;
    return x - Math.floor(x);
  }

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function easeInCubic(x) {
    return x * x * x;
  }

  function createKineticQr(canvas, options) {
    const opts = options || {};
    let currentTheme = opts.theme || 'obsidian';
    let currentMode = opts.mode || 'mdns';
    let particles = [];
    let qrSize = 0;
    let connectLabel = 'Connecting...';
    let progress = 0; // 0 = dismantled/scattered, 1 = crisp assembled
    let animDir = 0;  // +1 assembling, -1 dismantling, 0 idle
    let animStart = 0;
    let animDur = 480;
    let rafId = null;
    let statusBanner = '';
    let onDismantleDone = null;

    function buildParticles(rows, size) {
      qrSize = size;
      particles = [];
      const half = (size - 1) / 2;
      const maxDist = Math.sqrt(half * half * 2) || 1;

      for (let r = 0; r < size; r++) {
        const row = rows[r] || '';
        for (let c = 0; c < size; c++) {
          if (row[c] !== '1') continue;
          const dx = c - half;
          const dy = r - half;
          const distNorm = Math.sqrt(dx * dx + dy * dy) / maxDist;
          const baseAngle = Math.atan2(dy, dx);
          const swirl = (hashFloat(r, c, 1) - 0.5) * 1.35 + (dx === 0 && dy === 0 ? 0.5 : 0);
          const radialBoost = 0.55 + hashFloat(r, c, 2) * 0.95;

          const isFinder =
            (r < 7 && c < 7) ||
            (r < 7 && c >= size - 7) ||
            (r >= size - 7 && c < 7);

          particles.push({
            r,
            c,
            angle: baseAngle + swirl,
            radialBoost,
            stagger: isFinder ? distNorm * 0.14 : distNorm * 0.28,
            isFinder
          });
        }
      }
    }

    function drawRoundedRect(ctx, x, y, w, h, radius) {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function renderFrame(t) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 320;
      const cssH = canvas.clientHeight || 420;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);

      const theme = THEMES[currentTheme] || THEMES.obsidian;
      ctx.clearRect(0, 0, cssW, cssH);

      // Outer Card Surface
      drawRoundedRect(ctx, 1, 1, cssW - 2, cssH - 2, 22);
      ctx.fillStyle = theme.cardBg;
      ctx.fill();
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Header Branding
      ctx.fillStyle = theme.sub;
      ctx.font = '700 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('UXIOM MESH  •  4K ZERO-ROUTER P2P', 22, 20);

      ctx.fillStyle = theme.cardFg;
      ctx.font = '800 22px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillText('uDrop', 22, 36);

      // QR Well
      const qrBoxPad = 24;
      const qrBoxSize = Math.min(cssW - qrBoxPad * 2, cssH - 140);
      const qrBoxX = (cssW - qrBoxSize) / 2;
      const qrBoxY = 78;

      ctx.save();
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 16);
      ctx.fillStyle = theme.qrBg;
      ctx.globalAlpha = animDir === -1 ? Math.max(0.08, t) : Math.min(1, 0.25 + t * 0.75);
      ctx.fill();
      ctx.clip();

      const cx = qrBoxX + qrBoxSize / 2;
      const cy = qrBoxY + qrBoxSize / 2;

      if (qrSize > 0 && particles.length > 0) {
        const quiet = 16;
        const inner = qrBoxSize - quiet * 2;
        const cell = inner / qrSize;
        const maxScatter = qrBoxSize * 0.52;

        ctx.fillStyle = theme.qrFg;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const localRaw = Math.max(0, Math.min(1, (t - p.stagger) / (1 - 0.28)));
          const eased = animDir === -1 ? easeInCubic(localRaw) : easeOutCubic(localRaw);

          const tx = qrBoxX + quiet + p.c * cell;
          const ty = qrBoxY + quiet + p.r * cell;
          const scatterDist = (1 - eased) * maxScatter * p.radialBoost;
          const px = tx + Math.cos(p.angle) * scatterDist;
          const py = ty + Math.sin(p.angle) * scatterDist;
          const scale = 0.28 + 0.72 * eased;
          const alpha = Math.max(0, Math.min(1, eased * 1.15));

          ctx.globalAlpha = alpha;
          const drawW = Math.ceil(cell * scale);
          const ox = px + (cell - drawW) * 0.5;
          const oy = py + (cell - drawW) * 0.5;
          ctx.fillRect(ox, oy, drawW, drawW);
        }
      }

      if (statusBanner && t <= 0.25) {
        const badgeAlpha = Math.min(1, (0.25 - t) / 0.25);
        ctx.globalAlpha = badgeAlpha;
        ctx.fillStyle = theme.cardFg;
        ctx.font = '700 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(statusBanner, cx, cy);
        ctx.textAlign = 'left';
      }

      ctx.restore();

      // Footer Address & Status
      ctx.fillStyle = theme.sub;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText(connectLabel, 22, cssH - 22);

      ctx.restore();
    }

    function step(now) {
      if (!animDir) return;
      const elapsed = now - animStart;
      const frac = Math.min(1, elapsed / animDur);
      progress = animDir === 1 ? frac : (1 - frac);
      renderFrame(progress);

      if (frac < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        const finishedDir = animDir;
        animDir = 0;
        rafId = null;
        progress = finishedDir === 1 ? 1 : 0;
        renderFrame(progress);
        if (finishedDir === -1 && typeof onDismantleDone === 'function') {
          const cb = onDismantleDone;
          onDismantleDone = null;
          cb();
        }
      }
    }

    function startAnim(dir, dur, doneCb) {
      if (rafId) cancelAnimationFrame(rafId);
      animDir = dir;
      animDur = dur || (dir === 1 ? 480 : 520);
      animStart = performance.now();
      onDismantleDone = doneCb || null;
      rafId = requestAnimationFrame(step);
    }

    async function loadMatrix(mode) {
      if (mode) currentMode = mode;
      const res = await fetch(`/api/qr.matrix?mode=${encodeURIComponent(currentMode)}&t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      connectLabel = data.connectUrl || data.maskedLabel || '';
      buildParticles(data.rows || [], data.size || 0);
    }

    return {
      async assemble(optionsArg) {
        const o = optionsArg || {};
        if (o.theme) currentTheme = o.theme;
        if (o.mode) currentMode = o.mode;
        statusBanner = '';
        await loadMatrix(currentMode);
        progress = 0;
        startAnim(1, o.duration || 480);
      },
      async setTheme(theme) {
        currentTheme = theme || 'obsidian';
        if (particles.length === 0) {
          await loadMatrix(currentMode);
        }
        progress = 0;
        startAnim(1, 380);
      },
      disassemble(bannerText, doneCb) {
        statusBanner = bannerText || 'Paired Device Connected';
        if (particles.length === 0) {
          if (doneCb) doneCb();
          return;
        }
        startAnim(-1, 520, doneCb);
      },
      redraw() {
        renderFrame(progress);
      }
    };
  }

  global.createKineticQr = createKineticQr;
})(window);

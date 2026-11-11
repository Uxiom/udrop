(function (global) {
  const THEMES = {
    obsidian: {
      cardBgTop: '#1A1C23',
      cardBgBot: '#09090D',
      cardFg: '#FAFAFA',
      qrBgTop: '#161820',
      qrBgBot: '#0B0C10',
      qrFg: '#FAFAFA',
      qrGlow: 'rgba(255, 255, 255, 0.24)',
      sub: '#A1A1AA',
      rimHi: 'rgba(255, 255, 255, 0.55)',
      rimMid: 'rgba(180, 190, 210, 0.14)',
      sheenStart: 'rgba(255, 255, 255, 0.14)',
      flare: true
    },
    titanium: {
      cardBgTop: '#2E2E36',
      cardBgBot: '#1B1B20',
      cardFg: '#FAFAFA',
      qrBgTop: '#FAFAFA',
      qrBgBot: '#EFEFF2',
      qrFg: '#09090B',
      qrGlow: 'rgba(0, 0, 0, 0)',
      sub: '#D4D4D8',
      rimHi: 'rgba(255, 255, 255, 0.42)',
      rimMid: 'rgba(255, 255, 255, 0.12)',
      sheenStart: 'rgba(255, 255, 255, 0.11)',
      flare: true
    },
    paper: {
      cardBgTop: '#FFFFFF',
      cardBgBot: '#F2F2F5',
      cardFg: '#09090B',
      qrBgTop: '#0B0C10',
      qrBgBot: '#09090B',
      qrFg: '#FAFAFA',
      qrGlow: 'rgba(255, 255, 255, 0.2)',
      sub: '#52525B',
      rimHi: 'rgba(9, 9, 11, 0.22)',
      rimMid: 'rgba(9, 9, 11, 0.08)',
      sheenStart: 'rgba(255, 255, 255, 0.35)',
      flare: false
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

      function drawSpecularFlare(fx, fy, rx) {
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rx);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
        g.addColorStop(0.45, 'rgba(255, 255, 255, 0.18)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(1, 0.28);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Outer Frosted Glass Card Surface
      drawRoundedRect(ctx, 1, 1, cssW - 2, cssH - 2, 22);
      const outerFill = ctx.createLinearGradient(0, 0, cssW, cssH);
      outerFill.addColorStop(0, theme.cardBgTop);
      outerFill.addColorStop(1, theme.cardBgBot);
      ctx.fillStyle = outerFill;
      ctx.fill();

      const outerRim = ctx.createLinearGradient(0, 0, cssW, cssH);
      outerRim.addColorStop(0, theme.rimHi);
      outerRim.addColorStop(0.5, theme.rimMid);
      outerRim.addColorStop(1, theme.rimHi);
      ctx.strokeStyle = outerRim;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Header Branding
      ctx.fillStyle = theme.sub;
      ctx.font = '700 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('UXIOM MESH  •  4K ZERO-ROUTER P2P', 22, 20);

      ctx.fillStyle = theme.cardFg;
      ctx.font = '800 22px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillText('uDrop', 22, 36);

      // Liquid Glass QR Well
      const qrBoxPad = 24;
      const qrBoxSize = Math.min(cssW - qrBoxPad * 2, cssH - 140);
      const qrBoxX = (cssW - qrBoxSize) / 2;
      const qrBoxY = 78;

      ctx.save();
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
      const qrFill = ctx.createLinearGradient(qrBoxX, qrBoxY, qrBoxX + qrBoxSize, qrBoxY + qrBoxSize);
      qrFill.addColorStop(0, theme.qrBgTop);
      qrFill.addColorStop(1, theme.qrBgBot);
      ctx.fillStyle = qrFill;
      ctx.globalAlpha = animDir === -1 ? Math.max(0.08, t) : Math.min(1, 0.25 + t * 0.75);
      ctx.fill();
      ctx.clip();

      // 32-deg diagonal glass light reflection across top-left face
      const sheenGrad = ctx.createLinearGradient(qrBoxX, qrBoxY, qrBoxX + qrBoxSize * 0.65, qrBoxY + qrBoxSize * 0.85);
      sheenGrad.addColorStop(0, theme.sheenStart);
      sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sheenGrad;
      ctx.beginPath();
      ctx.moveTo(qrBoxX, qrBoxY);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.42, qrBoxY);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.72, qrBoxY + qrBoxSize);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.14, qrBoxY + qrBoxSize);
      ctx.closePath();
      ctx.fill();

      const cx = qrBoxX + qrBoxSize / 2;
      const cy = qrBoxY + qrBoxSize / 2;

      if (qrSize > 0 && particles.length > 0) {
        const quiet = 18;
        const inner = qrBoxSize - quiet * 2;
        const cell = inner / qrSize;
        const maxScatter = qrBoxSize * 0.52;

        ctx.fillStyle = theme.qrFg;
        ctx.shadowColor = theme.qrGlow;
        ctx.shadowBlur = 8;
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
        ctx.shadowBlur = 0;
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

      // Chrome Rim + Specular Edge Glints on QR Well
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
      ctx.strokeStyle = outerRim;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      if (theme.flare) {
        drawSpecularFlare(qrBoxX + qrBoxSize * 0.74, qrBoxY, 34);
        drawSpecularFlare(qrBoxX + qrBoxSize * 0.24, qrBoxY + qrBoxSize, 34);
      }

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

(function (global) {
  function hashFloat(r, c, salt) {
    const x = Math.sin((r + 1) * 12.9898 + (c + 1) * 78.233 + salt * 43.123) * 43758.5453;
    return x - Math.floor(x);
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

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function easeInCubic(x) {
    return x * x * x;
  }

  function readToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function createKineticQr(canvas, options) {
    const opts = options || {};
    let currentMode = opts.mode || 'mdns';
    let rows = [];
    let particles = [];
    let qrSize = 0;
    let connectLabel = '';
    let progress = 0;
    let animDir = 0;
    let animStart = 0;
    let animDur = 340;
    let rafId = null;
    let statusBanner = '';
    let onDismantleDone = null;
    let fetchPromise = null;

    // Pre-baked GPU textures: eliminates 550x per-frame shadowBlur and gradient allocations
    let plateCache = null;
    let plateKey = '';
    let qrCache = null;
    let qrCacheKey = '';
    let moduleSprite = null;

    function buildParticles(matrixRows, size) {
      rows = matrixRows || [];
      qrSize = size || 0;
      particles = [];
      if (qrSize <= 0) return;

      const half = (qrSize - 1) / 2;
      const maxDist = Math.sqrt(half * half * 2) || 1;

      for (let r = 0; r < qrSize; r++) {
        const row = rows[r] || '';
        for (let c = 0; c < qrSize; c++) {
          if (row[c] !== '1') continue;
          const dx = c - half;
          const dy = r - half;
          const distNorm = Math.sqrt(dx * dx + dy * dy) / maxDist;
          const baseAngle = Math.atan2(dy, dx);
          const swirl = (hashFloat(r, c, 1) - 0.5) * 1.35 + (dx === 0 && dy === 0 ? 0.5 : 0);
          const radialBoost = 0.55 + hashFloat(r, c, 2) * 0.90;
          const isFinder =
            (r < 7 && c < 7) ||
            (r < 7 && c >= qrSize - 7) ||
            (r >= qrSize - 7 && c < 7);

          particles.push({
            r,
            c,
            angle: baseAngle + swirl,
            radialBoost,
            stagger: isFinder ? distNorm * 0.14 : distNorm * 0.26
          });
        }
      }
    }

    function ensureModuleSprite() {
      if (moduleSprite) return moduleSprite;
      const off = document.createElement('canvas');
      off.width = 40;
      off.height = 40;
      const sctx = off.getContext('2d');

      // Soft optical glow baked once
      sctx.shadowColor = readToken('--glass-45');
      sctx.shadowBlur = 6;
      sctx.fillStyle = readToken('--color-white');
      drawRoundedRect(sctx, 8, 8, 24, 24, 4);
      sctx.fill();

      moduleSprite = off;
      return off;
    }

    function getMetrics() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cssW = (canvas && canvas.clientWidth) || 320;
      const cssH = (canvas && canvas.clientHeight) || 410;
      const qrBoxPad = 24;
      const qrBoxSize = Math.min(cssW - qrBoxPad * 2, cssH - 140);
      const qrBoxX = (cssW - qrBoxSize) / 2;
      const qrBoxY = 78;
      return { dpr, cssW, cssH, qrBoxSize, qrBoxX, qrBoxY };
    }

    function drawSpecularFlare(ctx, fx, fy, rx) {
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rx);
      g.addColorStop(0, readToken('--glass-90'));
      g.addColorStop(0.35, readToken('--glass-28'));
      g.addColorStop(1, readToken('--glass-0'));
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(1, 0.26);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function ensurePlateCache(m) {
      const key = `${m.cssW}x${m.cssH}@${m.dpr}|${connectLabel}`;
      if (plateCache && plateKey === key) return plateCache;

      const off = document.createElement('canvas');
      off.width = Math.round(m.cssW * m.dpr);
      off.height = Math.round(m.cssH * m.dpr);
      const ctx = off.getContext('2d');
      ctx.scale(m.dpr, m.dpr);

      const { cssW, cssH, qrBoxX, qrBoxY, qrBoxSize } = m;

      ctx.save();
      drawRoundedRect(ctx, 1, 1, cssW - 2, cssH - 2, 24);
      const outerFill = ctx.createLinearGradient(0, 0, cssW, cssH);
      outerFill.addColorStop(0, readToken('--glass-11'));
      outerFill.addColorStop(0.5, readToken('--qr-plate-mid'));
      outerFill.addColorStop(1, readToken('--qr-plate-deep'));
      ctx.fillStyle = outerFill;
      ctx.fill();
      ctx.clip();

      const domeGrad = ctx.createLinearGradient(0, 1, 0, 108);
      domeGrad.addColorStop(0, readToken('--glass-24'));
      domeGrad.addColorStop(1, readToken('--glass-0'));
      ctx.fillStyle = domeGrad;
      ctx.fillRect(0, 0, cssW, 108);
      ctx.restore();

      const outerRim = ctx.createLinearGradient(0, 0, cssW, cssH);
      outerRim.addColorStop(0, readToken('--glass-85'));
      outerRim.addColorStop(0.45, readToken('--qr-rim-cool'));
      outerRim.addColorStop(1, readToken('--glass-85'));
      drawRoundedRect(ctx, 1, 1, cssW - 2, cssH - 2, 24);
      ctx.strokeStyle = outerRim;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const bevelGrad = ctx.createLinearGradient(0, 0, 0, cssH);
      bevelGrad.addColorStop(0, readToken('--glass-36'));
      bevelGrad.addColorStop(0.5, readToken('--glass-0'));
      bevelGrad.addColorStop(1, readToken('--shadow-dark-36'));
      drawRoundedRect(ctx, 2.5, 2.5, cssW - 5, cssH - 5, 22.5);
      ctx.strokeStyle = bevelGrad;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = readToken('--qr-label-muted');
      ctx.font = '700 10px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('LOCAL WI-FI  •  4K ZERO-ROUTER P2P', 22, 20);

      ctx.fillStyle = readToken('--text-main');
      ctx.font = '800 22px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillText('uDrop', 22, 36);

      ctx.save();
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 22);
      const qrFill = ctx.createLinearGradient(qrBoxX, qrBoxY, qrBoxX + qrBoxSize, qrBoxY + qrBoxSize);
      qrFill.addColorStop(0, readToken('--glass-08'));
      qrFill.addColorStop(1, readToken('--qr-well-deep'));
      ctx.fillStyle = qrFill;
      ctx.fill();
      ctx.clip();

      const wellDome = ctx.createLinearGradient(qrBoxX, qrBoxY, qrBoxX, qrBoxY + qrBoxSize * 0.42);
      wellDome.addColorStop(0, readToken('--glass-22'));
      wellDome.addColorStop(1, readToken('--glass-0'));
      ctx.fillStyle = wellDome;
      ctx.fillRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize * 0.42);

      const sheenGrad = ctx.createLinearGradient(qrBoxX, qrBoxY, qrBoxX + qrBoxSize * 0.65, qrBoxY + qrBoxSize * 0.85);
      sheenGrad.addColorStop(0, readToken('--glass-19'));
      sheenGrad.addColorStop(1, readToken('--glass-0'));
      ctx.fillStyle = sheenGrad;
      ctx.beginPath();
      ctx.moveTo(qrBoxX, qrBoxY);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.42, qrBoxY);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.72, qrBoxY + qrBoxSize);
      ctx.lineTo(qrBoxX + qrBoxSize * 0.14, qrBoxY + qrBoxSize);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 22);
      ctx.strokeStyle = outerRim;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      drawSpecularFlare(ctx, 1 + (cssW - 2) * 0.78, 1, 38);
      drawSpecularFlare(ctx, 1 + (cssW - 2) * 0.22, cssH - 1, 38);
      drawSpecularFlare(ctx, qrBoxX + qrBoxSize * 0.74, qrBoxY, 32);
      drawSpecularFlare(ctx, qrBoxX + qrBoxSize * 0.24, qrBoxY + qrBoxSize, 32);

      if (connectLabel) {
        ctx.fillStyle = readToken('--qr-sublabel');
        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textBaseline = 'bottom';
        ctx.fillText(connectLabel, 22, cssH - 22);
      }

      plateCache = off;
      plateKey = key;
      return off;
    }

    function ensureQrCache(m) {
      if (qrSize <= 0 || rows.length === 0) return null;
      const key = `${m.qrBoxSize}@${m.dpr}|${rows.join('')}`;
      if (qrCache && qrCacheKey === key) return qrCache;

      const off = document.createElement('canvas');
      off.width = Math.round(m.qrBoxSize * m.dpr);
      off.height = Math.round(m.qrBoxSize * m.dpr);
      const ctx = off.getContext('2d');
      ctx.scale(m.dpr, m.dpr);

      const quiet = 18;
      const inner = m.qrBoxSize - quiet * 2;
      const cell = inner / qrSize;

      ctx.fillStyle = readToken('--color-white');
      ctx.shadowColor = readToken('--glass-36');
      ctx.shadowBlur = 7;

      const modRadius = Math.max(0, cell * 0.16);
      for (let r = 0; r < qrSize; r++) {
        const row = rows[r] || '';
        for (let c = 0; c < qrSize; c++) {
          if (row[c] !== '1') continue;
          const x = quiet + c * cell;
          const y = quiet + r * cell;
          if (modRadius >= 0.8 && cell >= 4) {
            drawRoundedRect(ctx, x, y, Math.ceil(cell), Math.ceil(cell), modRadius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, Math.ceil(cell), Math.ceil(cell));
          }
        }
      }

      qrCache = off;
      qrCacheKey = key;
      return off;
    }

    function renderFrame(t) {
      if (!canvas) return;
      const m = getMetrics();
      const targetW = Math.round(m.cssW * m.dpr);
      const targetH = Math.round(m.cssH * m.dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(m.dpr, m.dpr);
      ctx.clearRect(0, 0, m.cssW, m.cssH);

      const plate = ensurePlateCache(m);
      ctx.drawImage(plate, 0, 0, m.cssW, m.cssH);

      if (qrSize > 0 && particles.length > 0) {
        // When completely settled at t >= 1, blit pre-baked crisp glowing QR bitmap cleanly
        if (t >= 0.998 && animDir !== -1) {
          const qrImg = ensureQrCache(m);
          if (qrImg) {
            ctx.drawImage(qrImg, m.qrBoxX, m.qrBoxY, m.qrBoxSize, m.qrBoxSize);
          }
        } else {
          // Hardware-accelerated pre-baked sprite particle swirl — zero per-frame shadowBlur!
          const sprite = ensureModuleSprite();
          const quiet = 18;
          const inner = m.qrBoxSize - quiet * 2;
          const cell = inner / qrSize;
          const maxScatter = m.qrBoxSize * 0.52;

          ctx.save();
          drawRoundedRect(ctx, m.qrBoxX, m.qrBoxY, m.qrBoxSize, m.qrBoxSize, 22);
          ctx.clip();

          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const localRaw = Math.max(0, Math.min(1, (t - p.stagger) / (1 - 0.26)));
            const eased = animDir === -1 ? easeInCubic(localRaw) : easeOutCubic(localRaw);
            const alpha = Math.max(0, Math.min(1, eased * 1.15));
            if (alpha <= 0.03) continue;

            const tx = m.qrBoxX + quiet + p.c * cell;
            const ty = m.qrBoxY + quiet + p.r * cell;
            const scatterDist = (1 - eased) * maxScatter * p.radialBoost;
            const px = tx + Math.cos(p.angle) * scatterDist;
            const py = ty + Math.sin(p.angle) * scatterDist;
            const scale = 0.28 + 0.72 * eased;
            const drawW = cell * scale;
            const spriteBox = drawW / 0.6;
            const sx = px + (cell - drawW) * 0.5 - spriteBox * 0.2;
            const sy = py + (cell - drawW) * 0.5 - spriteBox * 0.2;

            ctx.globalAlpha = alpha;
            ctx.drawImage(sprite, sx, sy, spriteBox, spriteBox);
          }

          if (animDir === -1 && statusBanner && t <= 0.35) {
            const badgeAlpha = Math.min(1, (0.35 - t) / 0.35);
            ctx.globalAlpha = badgeAlpha;
            ctx.fillStyle = readToken('--text-main');
            ctx.font = '700 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(statusBanner, m.qrBoxX + m.qrBoxSize / 2, m.qrBoxY + m.qrBoxSize / 2);
          }
          ctx.restore();
        }
      } else {
        ctx.fillStyle = readToken('--qr-collecting');
        ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Collecting modules...', m.qrBoxX + m.qrBoxSize / 2, m.qrBoxY + m.qrBoxSize / 2);
      }

      ctx.restore();
    }

    function step(now) {
      if (!animDir) return;
      const elapsed = now - animStart;
      const frac = animDur <= 1 ? 1 : Math.min(1, elapsed / animDur);
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
      const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      animDir = dir;
      animDur = reducedMotion ? 1 : (dur || (dir === 1 ? 340 : 360));
      animStart = performance.now();
      onDismantleDone = doneCb || null;
      if (animDur <= 1) {
        progress = dir === 1 ? 1 : 0;
        animDir = 0;
        renderFrame(progress);
        if (dir === -1 && onDismantleDone) {
          const cb = onDismantleDone;
          onDismantleDone = null;
          cb();
        }
        return;
      }
      rafId = requestAnimationFrame(step);
    }

    async function loadMatrix(mode, forceRefresh) {
      if (mode) currentMode = mode;
      if (!forceRefresh && qrSize > 0 && rows.length > 0) return;
      if (!fetchPromise) {
        fetchPromise = fetch(`/api/qr.matrix?mode=${encodeURIComponent(currentMode)}`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data) {
              connectLabel = data.connectUrl || data.maskedLabel || '';
              buildParticles(data.rows || [], data.size || 0);
              qrCache = null;
              plateCache = null;
              ensureModuleSprite();
              const m = getMetrics();
              if (m.cssW > 0 && m.cssH > 0) {
                ensurePlateCache(m);
                ensureQrCache(m);
              }
            }
          })
          .catch(() => {})
          .finally(() => { fetchPromise = null; });
      }
      await fetchPromise;
    }

    return {
      async prefetch(mode) {
        await loadMatrix(mode || currentMode, true);
      },
      async assemble(optionsArg) {
        const o = optionsArg || {};
        if (o.mode && o.mode !== currentMode) {
          currentMode = o.mode;
          qrSize = 0;
          rows = [];
          particles = [];
        }
        statusBanner = '';
        if (qrSize > 0 && particles.length > 0) {
          progress = 0;
          startAnim(1, o.duration || 340);
          return;
        }
        renderFrame(0);
        await loadMatrix(currentMode, true);
        progress = 0;
        startAnim(1, o.duration || 340);
      },
      setTheme() {
        renderFrame(1);
      },
      disassemble(bannerText, doneCb) {
        statusBanner = bannerText || 'Paired Device Connected';
        if (qrSize === 0 || particles.length === 0) {
          if (doneCb) doneCb();
          return;
        }
        startAnim(-1, 360, doneCb);
      },
      redraw() {
        renderFrame(progress);
      }
    };
  }

  global.createKineticQr = createKineticQr;
})(window);

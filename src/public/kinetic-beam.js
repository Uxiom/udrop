/**
 * uDrop Kinetic Fluid Beam Engine
 * High-end fluid slingshot & metaball interaction physics.
 * 60fps GPU-accelerated canvas animation between Sender and Receiver nodes.
 */
(function (global) {
  'use strict';

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  function easeInCubic(x) {
    return x * x * x;
  }

  function springDamp(t, freq = 14, decay = 5) {
    return Math.exp(-decay * t) * Math.cos(freq * t);
  }

  const COLOR_TOKENS = {
    nodeBg: '--kinetic-node-bg',
    nodeRim: '--kinetic-node-rim',
    nodeRimGlow: '--kinetic-node-rim-glow',
    nodeShadow: '--kinetic-node-shadow',
    nodeIcon: '--kinetic-node-icon',
    gridDot: '--kinetic-grid-dot',
    watermark: '--kinetic-watermark',
    fiber: '--kinetic-fiber',
    coreWhite: '--kinetic-core-white',
    projectileGlow: '--kinetic-projectile-glow',
    trailDot: '--kinetic-trail-dot',
    successGreen: '--kinetic-success-green',
    successGlow: '--kinetic-success-glow',
    successBg: '--kinetic-success-bg',
    successBorder: '--kinetic-success-border',
    pillBg: '--kinetic-pill-bg',
    pillBorder: '--kinetic-pill-border',
    pillText: '--kinetic-pill-text',
    pillDot: '--kinetic-pill-dot'
  };

  function resolveTheme() {
    const theme = {};
    if (typeof document === 'undefined') return theme;
    try {
      const style = getComputedStyle(document.documentElement);
      for (const [key, propName] of Object.entries(COLOR_TOKENS)) {
        theme[key] = style.getPropertyValue(propName).trim();
      }
    } catch {
      // Fallback in environments without computed style
    }
    return theme;
  }

  function drawDeviceIcon(ctx, kind, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (kind === 'mobile' || kind === 'phone' || kind === 'ios' || kind === 'android') {
      // Smartphone silhouette
      const w = size * 0.58;
      const h = size * 0.95;
      const r = 3;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
      ctx.stroke();
      // Screen speaker / dynamic notch
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, -h / 2 + 2.5);
      ctx.lineTo(w * 0.22, -h / 2 + 2.5);
      ctx.stroke();
      // Home indicator bar
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, h / 2 - 2.5);
      ctx.lineTo(w * 0.25, h / 2 - 2.5);
      ctx.stroke();
    } else {
      // Laptop / PC silhouette
      const screenW = size * 0.85;
      const screenH = size * 0.58;
      ctx.beginPath();
      ctx.roundRect(-screenW / 2, -screenH / 2 - 2, screenW, screenH, 2);
      ctx.stroke();
      // Laptop base
      const baseW = size * 1.05;
      ctx.beginPath();
      ctx.moveTo(-baseW / 2, screenH / 2 + 1);
      ctx.lineTo(baseW / 2, screenH / 2 + 1);
      ctx.stroke();
      // Trackpad notch
      ctx.beginPath();
      ctx.moveTo(-3, screenH / 2 + 2.5);
      ctx.lineTo(3, screenH / 2 + 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMetaballLobe(ctx, x1, y1, R1, x2, y2, R2, pinch) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.001) return;

    const angle = Math.atan2(dy, dx);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const u1 = Math.PI / 2;
    const u2 = Math.PI / 2;

    const p1TopX = x1 + R1 * Math.cos(angle + u1);
    const p1TopY = y1 + R1 * Math.sin(angle + u1);
    const p1BotX = x1 + R1 * Math.cos(angle - u1);
    const p1BotY = y1 + R1 * Math.sin(angle - u1);

    const p2TopX = x2 + R2 * Math.cos(angle + u2);
    const p2TopY = y2 + R2 * Math.sin(angle + u2);
    const p2BotX = x2 + R2 * Math.cos(angle - u2);
    const p2BotY = y2 + R2 * Math.sin(angle - u2);

    const waistFactor = Math.max(0.08, 1 - pinch * 0.75);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const cpDist = dist * 0.35;

    ctx.beginPath();
    ctx.moveTo(p1TopX, p1TopY);
    ctx.bezierCurveTo(
      p1TopX + cpDist * cosA,
      p1TopY + cpDist * sinA,
      midX - cpDist * 0.3 * cosA,
      midY + (p2TopY - midY) * (1 - waistFactor),
      p2TopX,
      p2TopY
    );
    ctx.arc(x2, y2, R2, angle + u2, angle - u2, false);
    ctx.bezierCurveTo(
      midX - cpDist * 0.3 * cosA,
      midY + (p2BotY - midY) * (1 - waistFactor),
      p1BotX + cpDist * cosA,
      p1BotY + cpDist * sinA,
      p1BotX,
      p1BotY
    );
    ctx.arc(x1, y1, R1, angle - u1, angle + u1, false);
    ctx.closePath();
  }

  function drawDotGrid(ctx, w, h, dotColor) {
    if (!dotColor) return;
    const step = 18;
    const dotRadius = 1;

    ctx.fillStyle = dotColor;
    for (let x = step / 2; x < w; x += step) {
      for (let y = step / 2; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawDockedPill(ctx, theme, x, y, slotText, labelText, isSuccess) {
    ctx.save();
    const safeLabel = labelText.length > 14 ? labelText.slice(0, 12) + '...' : labelText;
    const text = `${slotText} ${safeLabel}`;
    ctx.font = '700 10.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
    const textW = ctx.measureText(text).width;
    const pillW = textW + 22;
    const pillH = 22;
    const r = 9999;

    ctx.translate(x - pillW / 2, y);

    // Pill Background
    ctx.fillStyle = isSuccess ? theme.successBg : theme.pillBg;
    ctx.strokeStyle = isSuccess ? theme.successBorder : theme.pillBorder;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(0, 0, pillW, pillH, r);
    ctx.fill();
    ctx.stroke();

    // Status indicator dot
    ctx.fillStyle = isSuccess ? theme.successGreen : theme.pillDot;
    if (isSuccess && theme.successGlow) {
      ctx.shadowColor = theme.successGlow;
      ctx.shadowBlur = 6;
    }
    ctx.beginPath();
    ctx.arc(9, pillH / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Text label
    ctx.shadowBlur = 0;
    ctx.fillStyle = isSuccess ? theme.successGreen : theme.pillText;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16, pillH / 2 + 0.5);

    ctx.restore();
  }

  function createKineticBeam(canvas, options = {}) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let senderSlot = options.senderSlot || 'YOU';
    let targetSlot = options.targetSlot || 'U';
    let senderName = options.senderName || 'My Device';
    let targetName = options.targetName || 'Host PC';
    let senderKind = options.senderKind || 'mobile';
    let targetKind = options.targetKind || 'desktop';

    let animFrameId = null;
    let isDestroyed = false;
    let dpr = 1;
    let cssW = 600;
    let cssH = 180;
    let theme = resolveTheme();
    let themeTick = 0;

    // Physics State
    let senderRecoil = 0;
    let senderRecoilTimer = 0;
    let receiverBulge = 0;
    let receiverBulgeTimer = 0;
    let receiverAnticipation = 0;
    let impactRipple = 0;

    // Slingshot projectile state
    let activeProjectiles = [];
    let isTensionActive = false;
    let tensionProgress = 0;
    let tensionStartTime = 0;
    let lastAutoStreamTime = 0;
    let currentTransferProgress = 0;
    let lastDockedBadge = null;

    function updateMetrics() {
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(300, rect.width || canvas.width || 600);
      cssH = Math.max(140, rect.height || canvas.height || 180);

      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      theme = resolveTheme();
    }

    function render(now) {
      if (isDestroyed) return;
      themeTick++;
      if (themeTick % 90 === 0) {
        theme = resolveTheme();
      }

      updateMetrics();

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      // 1. Technical Dotted Grid Background
      drawDotGrid(ctx, cssW, cssH, theme.gridDot);

      // Technical Watermark in corners
      if (theme.watermark) {
        ctx.fillStyle = theme.watermark;
        ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textBaseline = 'top';
        ctx.fillText('UXIOM P2P // KINETIC BEAM ENGINE', 16, 14);
        ctx.textBaseline = 'bottom';
        ctx.fillText(`STREAM: [ ${senderSlot} ] ---> [ ${targetSlot} ] • 60 FPS`, 16, cssH - 12);
      }

      // Center baseline geometry
      const centerY = Math.round(cssH * 0.44);
      const nodeRadius = Math.min(32, Math.max(26, cssW * 0.055));
      const margin = Math.max(nodeRadius + 28, cssW * 0.16);
      const baseX1 = margin;
      const baseX2 = cssW - margin;

      // Update recoil springs
      if (senderRecoilTimer > 0) {
        senderRecoilTimer += 0.016;
        senderRecoil = -26 * springDamp(senderRecoilTimer, 16, 6);
        if (senderRecoilTimer > 0.8) {
          senderRecoil = 0;
          senderRecoilTimer = 0;
        }
      }

      if (receiverBulgeTimer > 0) {
        receiverBulgeTimer += 0.016;
        receiverBulge = 24 * springDamp(receiverBulgeTimer, 15, 5);
        if (receiverBulgeTimer > 0.9) {
          receiverBulge = 0;
          receiverBulgeTimer = 0;
        }
      }

      const nodeX1 = baseX1 + senderRecoil;
      const nodeX2 = baseX2 + receiverBulge;

      // 2. Connecting Baseline Fiber (Subtle dashed path between nodes)
      if (theme.fiber) {
        ctx.save();
        ctx.strokeStyle = theme.fiber;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(nodeX1, centerY);
        ctx.lineTo(nodeX2, centerY);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Slingshot Tension Phase
      if (isTensionActive) {
        const elapsed = (now - tensionStartTime) / 1000;
        tensionProgress = Math.min(1, elapsed / 0.38);

        const maxStretch = Math.min(85, (baseX2 - baseX1) * 0.36);
        const stretchDist = easeOutCubic(tensionProgress) * maxStretch;
        const tipX = nodeX1 + stretchDist;
        const tipRadius = nodeRadius * (1 - tensionProgress * 0.38);

        // Fluid organic metaball stretch
        ctx.save();
        ctx.fillStyle = theme.nodeBg;
        ctx.strokeStyle = theme.nodeRim;
        ctx.lineWidth = 2.4;
        if (theme.nodeRimGlow) {
          ctx.shadowColor = theme.nodeRimGlow;
          ctx.shadowBlur = 10;
        }

        drawMetaballLobe(ctx, nodeX1, centerY, nodeRadius, tipX, centerY, tipRadius, tensionProgress);
        ctx.fill();
        ctx.stroke();

        // Glowing core in tip
        if (theme.coreWhite) {
          ctx.fillStyle = theme.coreWhite;
          ctx.beginPath();
          ctx.arc(tipX, centerY, Math.max(3, tipRadius * 0.45 * tensionProgress), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Snap launch threshold
        if (tensionProgress >= 1) {
          isTensionActive = false;
          senderRecoilTimer = 0.01;
          activeProjectiles.push({
            startX: tipX,
            startY: centerY,
            targetX: nodeX2,
            targetY: centerY,
            x: tipX,
            y: centerY,
            radius: tipRadius,
            progress: 0,
            startTime: now,
            duration: 420
          });
        }
      }

      // 4. Update and Draw Flying Projectiles
      for (let i = activeProjectiles.length - 1; i >= 0; i--) {
        const p = activeProjectiles[i];
        const elapsed = now - p.startTime;
        p.progress = Math.min(1, elapsed / p.duration);
        const eased = easeInCubic(p.progress * 0.6) + easeOutCubic(p.progress * 0.4);

        p.x = p.startX + (p.targetX - p.startX) * Math.min(1, eased);
        p.y = p.startY + Math.sin(p.progress * Math.PI) * -8;

        // Anticipation on receiver as projectile nears
        if (p.x > p.targetX - 70) {
          const antRatio = (p.x - (p.targetX - 70)) / 70;
          receiverAnticipation = Math.sin(antRatio * Math.PI) * 14;
        } else {
          receiverAnticipation = 0;
        }

        // Projectile squash & stretch along vector
        const stretchX = 1.35;
        const stretchY = 0.72;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(stretchX, stretchY);

        ctx.fillStyle = theme.nodeBg;
        ctx.strokeStyle = theme.coreWhite;
        ctx.lineWidth = 2.2;
        if (theme.projectileGlow) {
          ctx.shadowColor = theme.projectileGlow;
          ctx.shadowBlur = 12;
        }

        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = theme.nodeRim;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Trailing micro-droplets
        for (let t = 1; t <= 3; t++) {
          const trailX = p.x - t * 14;
          const trailR = Math.max(1.5, (p.radius * 0.28) / t);
          ctx.save();
          ctx.globalAlpha = Math.min(1, 0.7 / t);
          ctx.fillStyle = theme.trailDot;
          ctx.beginPath();
          ctx.arc(trailX, p.y, trailR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Impact detection
        if (p.progress >= 1 || p.x >= p.targetX - nodeRadius * 0.5) {
          activeProjectiles.splice(i, 1);
          receiverAnticipation = 0;
          receiverBulgeTimer = 0.01;
          impactRipple = 0.01;
        }
      }

      // 5. Impact Shockwave Ripple
      if (impactRipple > 0) {
        impactRipple += 0.035;
        const ripR = nodeRadius + impactRipple * 38;
        const ripAlpha = Math.max(0, 1 - impactRipple);
        ctx.save();
        ctx.globalAlpha = ripAlpha * 0.8;
        ctx.strokeStyle = theme.successGreen;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(nodeX2, centerY, ripR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        if (impactRipple >= 1) impactRipple = 0;
      }

      // 6. Draw Sender Node (Left)
      ctx.save();
      ctx.translate(nodeX1, centerY);

      ctx.fillStyle = theme.nodeBg;
      ctx.strokeStyle = theme.nodeRim;
      ctx.lineWidth = 2.4;
      if (theme.nodeShadow) {
        ctx.shadowColor = theme.nodeShadow;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(0, 0, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Device Icon Inside Node
      drawDeviceIcon(ctx, senderKind, 0, 0, nodeRadius * 0.72, theme.nodeIcon);
      ctx.restore();

      // Sender Docked Pill Badge below
      const pillY = centerY + nodeRadius + 18;
      drawDockedPill(ctx, theme, nodeX1, pillY, `[ ${senderSlot} ]`, senderName, false);

      // 7. Draw Receiver Node (Right, with anticipation stretch)
      ctx.save();
      const recX = nodeX2 - receiverAnticipation;
      ctx.translate(recX, centerY);

      ctx.fillStyle = theme.nodeBg;
      ctx.strokeStyle = impactRipple > 0 ? theme.successGreen : theme.nodeRim;
      ctx.lineWidth = 2.4;
      if (impactRipple > 0 && theme.successGlow) {
        ctx.shadowColor = theme.successGlow;
        ctx.shadowBlur = 14;
      } else if (theme.nodeShadow) {
        ctx.shadowColor = theme.nodeShadow;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(0, 0, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Device Icon Inside Target Node
      drawDeviceIcon(
        ctx,
        targetKind,
        0,
        0,
        nodeRadius * 0.72,
        impactRipple > 0 ? theme.successGreen : theme.nodeIcon
      );
      ctx.restore();

      // Receiver Docked Pill Badge below
      const isTargetSuccess = (impactRipple > 0 || currentTransferProgress >= 100);
      drawDockedPill(
        ctx,
        theme,
        recX,
        pillY,
        `[ ${targetSlot} ]`,
        lastDockedBadge ? lastDockedBadge.text : targetName,
        isTargetSuccess
      );

      ctx.restore();
      animFrameId = requestAnimationFrame(render);
    }

    // Start loop
    updateMetrics();
    animFrameId = requestAnimationFrame(render);

    window.addEventListener('resize', updateMetrics);

    return {
      setSlots(fromSlot, toSlot, fromName, toName, fromKind, toKind) {
        if (fromSlot) senderSlot = fromSlot;
        if (toSlot) targetSlot = toSlot;
        if (fromName) senderName = fromName;
        if (toName) targetName = toName;
        if (fromKind) senderKind = fromKind;
        if (toKind) targetKind = toKind;
      },
      triggerLaunch(meta = {}) {
        if (meta.name) {
          lastDockedBadge = {
            text: meta.name,
            size: meta.size || 0,
            time: Date.now()
          };
        }
        isTensionActive = true;
        tensionStartTime = performance.now();
        tensionProgress = 0;
      },
      updateProgress(percent, speedMb) {
        currentTransferProgress = percent;
        const now = performance.now();
        if (percent > 0 && percent < 100 && now - lastAutoStreamTime > 650 && activeProjectiles.length === 0 && !isTensionActive) {
          lastAutoStreamTime = now;
          this.triggerLaunch({});
        }
      },
      complete(meta = {}) {
        currentTransferProgress = 100;
        this.triggerLaunch(meta);
      },
      reset() {
        activeProjectiles = [];
        isTensionActive = false;
        currentTransferProgress = 0;
        lastDockedBadge = null;
        impactRipple = 0;
      },
      destroy() {
        isDestroyed = true;
        if (animFrameId) cancelAnimationFrame(animFrameId);
        window.removeEventListener('resize', updateMetrics);
      }
    };
  }

  global.createKineticBeam = createKineticBeam;
})(typeof window !== 'undefined' ? window : this);

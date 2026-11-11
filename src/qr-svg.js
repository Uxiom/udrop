import QRCode from 'qrcode';

/**
 * Generates a sleek, custom-styled SVG QR code inspired by brutalist & luxury design:
 * - Rounded squircle finder eyes (outer + inner)
 * - Soft rounded data modules
 * - Central brand emblem [ U ] cutout (using Level H 30% error correction)
 * - Monochromatic poster card container with crisp typography
 */
export function generateSleekQrSvg(url, {
  accentColor = '#09090B',
  darkColor = '#FAFAFA',
  brandText = 'uDrop',
  subText = 'ZERO-ROUTER 4K P2P',
  footerText = 'Scan with iPhone or Android Camera',
  displayLabel = null
} = {}) {
  // Use Level 'H' (High - 30% error correction) to allow clean center emblem cutout
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const data = qr.modules;

  // Center logo island boundary (7x7 modules in center)
  const centerStart = Math.floor((size - 7) / 2);
  const centerEnd = centerStart + 6;

  // Function to check if a module belongs to the 3 finder pattern zones (7x7 corners)
  function isFinderPattern(r, c) {
    if (r < 7 && c < 7) return true; // Top-left
    if (r < 7 && c >= size - 7) return true; // Top-right
    if (r >= size - 7 && c < 7) return true; // Bottom-left
    return false;
  }

  // Function to check if a module is in the center logo island
  function isCenterIsland(r, c) {
    return (r >= centerStart && r <= centerEnd && c >= centerStart && c <= centerEnd);
  }

  // Build custom SVG data modules
  const modulesSvg = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFinderPattern(r, c) || isCenterIsland(r, c)) continue;

      if (data.get(r, c)) {
        // Soft rounded module dot
        modulesSvg.push(
          `<rect x="${(c + 0.1).toFixed(2)}" y="${(r + 0.1).toFixed(2)}" width="0.8" height="0.8" rx="0.32" fill="${darkColor}" />`
        );
      }
    }
  }

  // Custom sleek squircle finder eyes
  function renderFinderEye(x, y) {
    return `
      <!-- Outer Squircle Frame -->
      <rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="${darkColor}" stroke-width="1.0" />
      <!-- Inner Solid Squircle Eye -->
      <rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${darkColor}" />
    `;
  }

  const eyeTopLeft = renderFinderEye(0, 0);
  const eyeTopRight = renderFinderEye(size - 7, 0);
  const eyeBottomLeft = renderFinderEye(0, size - 7);

  // Center logo emblem: [ U ] target glyph
  const centerBoxX = centerStart;
  const centerBoxY = centerStart;
  const centerBoxSize = 7;
  const emblemSvg = `
    <!-- Center Island Blanking -->
    <rect x="${centerBoxX + 0.2}" y="${centerBoxY + 0.2}" width="${centerBoxSize - 0.4}" height="${centerBoxSize - 0.4}" rx="1.5" fill="${accentColor}" />
    <!-- Branded [ U ] Viewfinder Glyph -->
    <g transform="translate(${centerBoxX + 1.2}, ${centerBoxY + 1.2}) scale(${((centerBoxSize - 2.4) / 24).toFixed(3)})">
      <path d="M 4 5 L 4 16 A 8 8 0 0 0 20 16 L 20 5" fill="none" stroke="${darkColor}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="1" y1="5" x2="6" y2="5" stroke="${darkColor}" stroke-width="3" stroke-linecap="round"/>
      <line x1="18" y1="5" x2="23" y2="5" stroke="${darkColor}" stroke-width="3" stroke-linecap="round"/>
    </g>
  `;

  // Total Card Layout (Poster Style)
  const cardWidth = 380;
  const cardHeight = 520;
  const qrPadding = 35;
  const qrDisplaySize = cardWidth - (qrPadding * 2);

  // Privacy-first label: Never expose raw IP strings visually on the card
  const renderedLabel = displayLabel || url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const normFg = darkColor.toLowerCase();
  const isLightForeground = (normFg === '#ffffff' || normFg === '#fff' || normFg === '#fafafa' || normFg === '#f4f4f5');
  const cardBorder = isLightForeground ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.14)';
  const subTextColor = isLightForeground ? '#A1A1AA' : '#71717A';
  const brandSubColor = isLightForeground ? '#71717A' : '#52525B';
  const pillBgColor = isLightForeground ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const pillBorder = isLightForeground ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.12)';
  const badgeBg = isLightForeground ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)';
  const badgeBorder = isLightForeground ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.14)';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cardWidth} ${cardHeight}" width="100%" height="100%">
  <defs>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="rgba(0, 0, 0, 0.55)" />
    </filter>
  </defs>

  <!-- Background Card -->
  <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" rx="28" fill="${accentColor}" stroke="${cardBorder}" stroke-width="1.2" filter="url(#cardShadow)" />

  <!-- Subtle Top Badge / Notification -->
  <g transform="translate(30, 32)">
    <!-- 5G Protocol Pill -->
    <rect x="270" y="-3" width="50" height="24" rx="12" fill="${badgeBg}" stroke="${badgeBorder}" stroke-width="1" />
    <circle cx="282" cy="9" r="3.5" fill="#22C55E" />
    <text x="302" y="13" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" font-size="10.5" font-weight="800" fill="${darkColor}" text-anchor="middle">5G</text>

    <text x="0" y="8" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" text-transform="uppercase" fill="${brandSubColor}">UXIOM MESH</text>
    <text x="0" y="32" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="900" letter-spacing="-1.2" fill="${darkColor}">${brandText.toUpperCase()}</text>
    <text x="0" y="47" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9" font-weight="800" letter-spacing="1" fill="${subTextColor}">${subText}</text>
  </g>

  <!-- Centered Custom QR Canvas -->
  <g transform="translate(${qrPadding}, 105)">
    <!-- QR Coordinate System Scaled to viewBox (size x size) -->
    <svg viewBox="0 0 ${size} ${size}" width="${qrDisplaySize}" height="${qrDisplaySize}">
      <!-- Finder Patterns -->
      ${eyeTopLeft}
      ${eyeTopRight}
      ${eyeBottomLeft}
      <!-- Data Modules -->
      ${modulesSvg.join('\n      ')}
      <!-- Center Emblem -->
      ${emblemSvg}
    </svg>
  </g>

  <!-- Bottom Metadata & Instructions -->
  <g transform="translate(35, 440)">
    <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" fill="${darkColor}">Master Node [ U ]</text>
    <text x="0" y="15" font-family="ui-monospace, SFMono-Regular, monospace" font-size="10.5" font-weight="600" fill="${subTextColor}">${renderedLabel}</text>

    <!-- Sleek Glass Pill Button -->
    <g transform="translate(0, 26)">
      <rect x="0" y="0" width="${cardWidth - 70}" height="32" rx="10" fill="${pillBgColor}" stroke="${pillBorder}" stroke-width="1" />
      <text x="${(cardWidth - 70) / 2}" y="20" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" fill="${darkColor}" text-anchor="middle">${footerText}</text>
    </g>
  </g>
</svg>`;
}

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB Chunks

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const mediaInput = document.getElementById('mediaInput');
const pickMediaBtn = document.getElementById('pickMediaBtn');
const pickFilesBtn = document.getElementById('pickFilesBtn');
const batchSummaryBar = document.getElementById('batchSummaryBar');
const batchCountBadge = document.getElementById('batchCountBadge');
const batchProgressStats = document.getElementById('batchProgressStats');
const batchProgressBar = document.getElementById('batchProgressBar');
const queueListWrapper = document.getElementById('queueListWrapper');
const queueItemsList = document.getElementById('queueItemsList');
const retryFailedBtn = document.getElementById('retryFailedBtn');
const wakeLockVideo = document.getElementById('wakeLockVideo');
const dropzoneHintText = document.getElementById('dropzoneHintText');
const hostNameEl = document.getElementById('hostName');
const mascotFace = document.getElementById('mascotFace');
const transferContainer = document.getElementById('transferContainer');
const transferFileName = document.getElementById('transferFileName');
const transferStats = document.getElementById('transferStats');
const transferSpeed = document.getElementById('transferSpeed');
const transferEta = document.getElementById('transferEta');
const progressBar = document.getElementById('progressBar');
const transferChunks = document.getElementById('transferChunks');
const transferStatus = document.getElementById('transferStatus');
const cancelTransferBtn = document.getElementById('cancelTransferBtn');
const hostFilesList = document.getElementById('hostFilesList');

const activeUploadSessions = new Map(); // fileId -> AbortController
let isCurrentTransferCancelled = false;
const refreshFilesBtn = document.getElementById('refreshFilesBtn');

// UXIOM Mesh DOM Elements
const mySlotBadge = document.getElementById('mySlotBadge');
const meshRing = document.getElementById('meshRing');
const targetNodeText = document.getElementById('targetNodeText');
const dropzoneActionText = document.getElementById('dropzoneActionText');
const incomingTransferCard = document.getElementById('incomingTransferCard');
const incomingFromText = document.getElementById('incomingFromText');
const incomingThumbBox = document.getElementById('incomingThumbBox');
const incomingTypeBadge = document.getElementById('incomingTypeBadge');
const incomingFileName = document.getElementById('incomingFileName');
const incomingFileSize = document.getElementById('incomingFileSize');
const incomingDestHint = document.getElementById('incomingDestHint');
const incomingContextBtn = document.getElementById('incomingContextBtn');
const incomingDownloadBtn = document.getElementById('incomingDownloadBtn');
const dismissIncomingBtn = document.getElementById('dismissIncomingBtn');

// Liquid Glass Dynamic Island Elements
const dynamicIsland = document.getElementById('dynamicIsland');
const islandFromNode = document.getElementById('islandFromNode');
const islandSpeed = document.getElementById('islandSpeed');
const islandFileName = document.getElementById('islandFileName');
const islandProgressBar = document.getElementById('islandProgressBar');
const islandPercent = document.getElementById('islandPercent');
const islandCompleteName = document.getElementById('islandCompleteName');
const islandCompleteSize = document.getElementById('islandCompleteSize');
const islandOpenFolderBtn = document.getElementById('islandOpenFolderBtn');
const islandDismissBtn = document.getElementById('islandDismissBtn');

// Dynamic Island State & Audio
let islandRevertTimer = null;
let currentHostTransfer = null;
let lastReceivedFile = null;
let islandAudioCtx = null;

// Receive Notification Toast State
const receiveToast = document.getElementById('receiveToast');
const receiveToastIcon = document.getElementById('receiveToastIcon');
const receiveToastBadge = document.getElementById('receiveToastBadge');
const receiveToastTitle = document.getElementById('receiveToastTitle');
const receiveToastName = document.getElementById('receiveToastName');
const receiveToastMeta = document.getElementById('receiveToastMeta');
const receiveToastActionBtn = document.getElementById('receiveToastActionBtn');
const receiveToastCloseBtn = document.getElementById('receiveToastCloseBtn');
let receiveToastTimer = null;
let currentToastAction = null;
const seenOutboundIds = new Set();
let outboundBaselineReady = false;
const recentlyUploadedNames = new Map();

// Offline Inline Lucide Icons (HIG SF-Symbols web equivalent)
const LUCIDE_PATHS = {
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect>',
  music: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
  'file-archive': '<path d="M10 12v-1"></path><path d="M10 18v-2"></path><path d="M10 7V6"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01"></path><circle cx="10" cy="20" r="2"></circle>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"></path>',
  'external-link': '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  play: '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
};

function renderLucideSvg(name, size = 14, strokeWidth = 2) {
  const paths = LUCIDE_PATHS[name] || LUCIDE_PATHS.download;
  return `<svg class="lucide lucide-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function getCategoryLucideName(category) {
  switch (category) {
    case 'photo': return 'image';
    case 'video': return 'video';
    case 'contact': return 'user-plus';
    case 'pdf':
    case 'doc': return 'file-text';
    case 'audio': return 'music';
    case 'archive': return 'file-archive';
    default: return 'download';
  }
}

function getActionLucideName(ctx, actionLabel) {
  if (actionLabel === 'Show') return 'folder-open';
  if (!ctx) return 'download';
  if (ctx.category === 'contact') return 'user-plus';
  if (ctx.category === 'pdf') return 'external-link';
  if (ctx.category === 'audio') return 'play';
  return 'download';
}

// UXIOM Mesh State
let myClientId = localStorage.getItem('udrop_mesh_client_id');
if (!myClientId) {
  myClientId = 'client_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11));
  localStorage.setItem('udrop_mesh_client_id', myClientId);
}

let mySlot = null; // 'X', 'I', 'O', 'M' or 'U'
let targetSlot = 'U'; // Default recipient: Host [ U ]
let userPickedTarget = false;
let currentRingState = [];
let meshEventSource = null;
let leaveBeaconSent = false;

function hideReceiveToast() {
  if (!receiveToast) return;
  receiveToast.classList.add('hidden');
  receiveToast.classList.remove('is-clickable');
  currentToastAction = null;
  if (receiveToastTimer) {
    clearTimeout(receiveToastTimer);
    receiveToastTimer = null;
  }
}

function showReceiveToast({ title, fileName, meta, badge, category, actionLabel, actionIcon, onAction }) {
  if (!receiveToast) return;
  if (receiveToastTitle) receiveToastTitle.textContent = title || 'File Received';
  if (receiveToastName) receiveToastName.textContent = fileName || 'Transfer Complete';
  if (receiveToastMeta) receiveToastMeta.textContent = meta || '';
  if (receiveToastBadge) receiveToastBadge.textContent = badge || 'FILE';
  if (receiveToastIcon) {
    const appIconName = getCategoryLucideName(category);
    receiveToastIcon.setAttribute('data-lucide', appIconName);
    receiveToastIcon.innerHTML = renderLucideSvg(appIconName, 18, 2);
  }

  currentToastAction = typeof onAction === 'function' ? onAction : null;
  receiveToast.classList.toggle('is-clickable', Boolean(currentToastAction));
  if (receiveToastActionBtn) {
    if (actionLabel && currentToastAction) {
      const iconName = actionIcon || getActionLucideName({ category }, actionLabel);
      receiveToastActionBtn.innerHTML = `${renderLucideSvg(iconName, 13, 2.2)}<span>${escapeHtml(actionLabel)}</span>`;
      receiveToastActionBtn.classList.remove('hidden');
    } else {
      receiveToastActionBtn.classList.add('hidden');
    }
  }

  receiveToast.classList.remove('hidden');
  playSuccessChime();
  if (navigator.vibrate) {
    try { navigator.vibrate([80, 40, 80]); } catch {}
  }

  if (receiveToastTimer) clearTimeout(receiveToastTimer);
  receiveToastTimer = setTimeout(hideReceiveToast, 6500);
}

if (receiveToastCloseBtn) {
  receiveToastCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideReceiveToast();
  });
}

if (receiveToastActionBtn) {
  receiveToastActionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fn = currentToastAction;
    hideReceiveToast();
    if (fn) fn();
  });
}

if (receiveToast) {
  receiveToast.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#receiveToastCloseBtn')) return;
    if (!currentToastAction) return;
    const fn = currentToastAction;
    hideReceiveToast();
    fn();
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function isLocalHostPage() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

const CONTEXT_UI_META = {
  photo: {
    badge: 'PHOTO',
    iconLabel: 'IMG',
    hint: 'Save to Photos or Downloads',
    actionLabel: 'Save Photo',
    actionKind: 'share-or-inline',
    mimeFallback: 'image/jpeg'
  },
  video: {
    badge: 'VIDEO',
    iconLabel: 'VID',
    hint: 'Save to Photos / Video or Files',
    actionLabel: 'Save Video',
    actionKind: 'share-or-inline',
    mimeFallback: 'video/mp4'
  },
  contact: {
    badge: 'CONTACT',
    iconLabel: 'VCF',
    hint: 'Opens directly in Contacts',
    actionLabel: 'Add Contact',
    actionKind: 'inline-link',
    mimeFallback: 'text/vcard'
  },
  pdf: {
    badge: 'PDF',
    iconLabel: 'PDF',
    hint: 'Preview or save to Files',
    actionLabel: 'Preview',
    actionKind: 'inline-tab',
    mimeFallback: 'application/pdf'
  },
  audio: {
    badge: 'AUDIO',
    iconLabel: 'AUD',
    hint: 'Play inline or save to Files',
    actionLabel: 'Play',
    actionKind: 'inline-tab',
    mimeFallback: 'audio/mpeg'
  },
  archive: {
    badge: 'ARCHIVE',
    iconLabel: 'ZIP',
    hint: 'Saves to Files / Downloads',
    actionLabel: '',
    actionKind: 'none',
    mimeFallback: 'application/zip'
  },
  doc: {
    badge: 'DOC',
    iconLabel: 'DOC',
    hint: 'Saves to Files / Downloads',
    actionLabel: '',
    actionKind: 'none',
    mimeFallback: 'application/octet-stream'
  },
  file: {
    badge: 'FILE',
    iconLabel: 'FILE',
    hint: 'Saves to Downloads',
    actionLabel: '',
    actionKind: 'none',
    mimeFallback: 'application/octet-stream'
  }
};

function inferCategoryFromName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.bmp'].includes(ext)) return 'photo';
  if (['.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.vcf', '.vcard'].includes(ext)) return 'contact';
  if (ext === '.pdf') return 'pdf';
  if (['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive';
  if (['.txt', '.csv', '.md', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) return 'doc';
  return 'file';
}

function getClientFileContext(fileName, serverMeta) {
  const cat = (serverMeta && serverMeta.category && CONTEXT_UI_META[serverMeta.category])
    ? serverMeta.category
    : inferCategoryFromName(fileName);
  const base = CONTEXT_UI_META[cat] || CONTEXT_UI_META.file;
  const mime = (serverMeta && serverMeta.mime) ? serverMeta.mime : base.mimeFallback;
  const inlineSafe = serverMeta && typeof serverMeta.inlineSafe === 'boolean'
    ? serverMeta.inlineSafe
    : (cat === 'photo' || cat === 'contact' || cat === 'pdf' || cat === 'audio' || (cat === 'video' && !String(fileName || '').toLowerCase().endsWith('.mkv')));
  return { category: cat, mime, inlineSafe, ...base };
}

async function triggerContextSaveAction(downloadUrl, fileName, fileSize, ctx, btnEl) {
  const inlineUrl = downloadUrl + (downloadUrl.includes('?') ? '&' : '?') + 'inline=1';

  // Use OS Share Sheet when available (opens iOS "Save Image/Video" into Photos)
  if (
    ctx.actionKind === 'share-or-inline' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    (!fileSize || fileSize <= 120 * 1024 * 1024)
  ) {
    const prevHtml = btnEl ? btnEl.innerHTML : '';
    try {
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Preparing...';
      }
      const res = await fetch(downloadUrl);
      const blob = await res.blob();
      const shareFile = new File([blob], fileName, { type: blob.type || ctx.mime });
      if (navigator.canShare({ files: [shareFile] })) {
        await navigator.share({ files: [shareFile], title: fileName });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = prevHtml;
      }
    }
  }

  if (ctx.inlineSafe) {
    if (ctx.category === 'contact') {
      window.location.href = inlineUrl;
    } else {
      window.open(inlineUrl, '_blank', 'noopener');
    }
    return;
  }

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.setAttribute('download', fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 1. Fetch Host Device Info
async function checkHostConnection() {
  try {
    const res = await fetch('/api/info');
    if (!res.ok) throw new Error();
    const data = await res.json();
    hostNameEl.textContent = data.hostname;
    if (hostNameEl.parentElement) {
      hostNameEl.parentElement.title = `Connected to ${data.hostname} (${data.platform})`;
    }
  } catch (err) {
    hostNameEl.textContent = 'Connecting...';
  }
}

// 2. Fetch Available Files from Host
async function loadHostFiles() {
  try {
    const res = await fetch('/api/files');
    const files = await res.json();
    if (!files || files.length === 0) {
      outboundBaselineReady = true;
      hostFilesList.innerHTML = '<p class="empty-state">No files currently shared by the host.</p>';
      return;
    }

    const canUnshare = isLocalHostPage();
    if (!outboundBaselineReady) {
      files.forEach(f => seenOutboundIds.add(f.id));
      outboundBaselineReady = true;
    } else if (!canUnshare) {
      const nowMs = Date.now();
      for (const [n, ts] of recentlyUploadedNames.entries()) {
        if (nowMs - ts > 15000) recentlyUploadedNames.delete(n);
      }
      const newlyShared = files.find(f => !seenOutboundIds.has(f.id) && !recentlyUploadedNames.has(f.name));
      files.forEach(f => seenOutboundIds.add(f.id));
      if (newlyShared) {
        const nCtx = getClientFileContext(newlyShared.name, newlyShared);
        const dlUrl = `/api/download/${encodeURIComponent(newlyShared.id)}`;
        const actLabel = nCtx.actionLabel || 'Download';
        showReceiveToast({
          title: 'File Received from Host',
          fileName: newlyShared.name,
          meta: `${formatBytes(newlyShared.size)} • ${nCtx.hint}`,
          badge: nCtx.badge,
          category: nCtx.category,
          actionLabel: actLabel,
          actionIcon: getActionLucideName(nCtx, actLabel),
          onAction: () => triggerContextSaveAction(dlUrl, newlyShared.name, newlyShared.size, nCtx, receiveToastActionBtn)
        });
      }
    } else {
      files.forEach(f => seenOutboundIds.add(f.id));
    }
    hostFilesList.innerHTML = files.map(f => {
      const safeName = escapeHtml(f.name);
      const safeId = encodeURIComponent(f.id);
      const downloadUrl = `/api/download/${safeId}`;
      const ctx = getClientFileContext(f.name, f);
      const thumbHtml = ctx.category === 'photo'
        ? `<div class="file-thumb-box"><img src="${downloadUrl}?inline=1" class="file-thumb" loading="lazy" alt=""></div>`
        : `<div class="file-thumb-box file-thumb-badge">${renderLucideSvg(getCategoryLucideName(ctx.category), 18, 1.9)}</div>`;
      const actionIconHtml = renderLucideSvg(getActionLucideName(ctx, ctx.actionLabel), 13, 2.2);
      const actionHtml = ctx.actionLabel
        ? (ctx.actionKind === 'inline-link' && ctx.inlineSafe
            ? `<a href="${downloadUrl}?inline=1" class="btn-context-action">${actionIconHtml}<span>${escapeHtml(ctx.actionLabel)}</span></a>`
            : (ctx.actionKind === 'inline-tab' && ctx.inlineSafe
                ? `<a href="${downloadUrl}?inline=1" target="_blank" rel="noopener" class="btn-context-action">${actionIconHtml}<span>${escapeHtml(ctx.actionLabel)}</span></a>`
                : `<button type="button" class="btn-context-action js-context-save" data-url="${downloadUrl}" data-name="${safeName}" data-size="${Number(f.size) || 0}" data-cat="${escapeHtml(ctx.category)}" data-mime="${escapeHtml(ctx.mime)}">${actionIconHtml}<span>${escapeHtml(ctx.actionLabel)}</span></button>`))
        : '';

      return `
      <div class="file-row">
        ${thumbHtml}
        <div class="file-row-info">
          <div class="file-title-line">
            <span class="file-kind-pill">${escapeHtml(ctx.badge)}</span>
            <span class="file-row-name" title="${safeName}">${safeName}</span>
          </div>
          <div class="file-meta-line">
            <span class="file-row-size">${formatBytes(f.size)}</span>
            <span class="meta-dot">•</span>
            <span class="file-dest-hint">${escapeHtml(ctx.hint)}</span>
          </div>
        </div>
        <div class="file-row-actions">
          ${actionHtml}
          <a href="${downloadUrl}" class="btn-download" download>${renderLucideSvg('download', 13, 2.2)}<span>Download</span></a>
          ${canUnshare ? `<button type="button" class="btn-unshare" data-unshare-id="${safeId}" title="Remove from shared list" aria-label="Remove ${safeName} from shared list">${renderLucideSvg('x', 13, 2.2)}</button>` : ''}
        </div>
      </div>
    `;
    }).join('');

    hostFilesList.querySelectorAll('.js-context-save').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        const name = btn.getAttribute('data-name') || 'file';
        const size = Number(btn.getAttribute('data-size') || '0');
        const cat = btn.getAttribute('data-cat');
        const mime = btn.getAttribute('data-mime');
        const ctx = getClientFileContext(name, { category: cat, mime, inlineSafe: true });
        triggerContextSaveAction(url, name, size, ctx, btn);
      });
    });

    if (canUnshare) {
      hostFilesList.querySelectorAll('.btn-unshare').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-unshare-id');
          if (!id) return;
          try {
            await fetch(`/api/outbound/${id}`, { method: 'DELETE' });
            loadHostFiles();
          } catch (e) {}
        });
      });
    }
  } catch (err) {
    hostFilesList.innerHTML = '<p class="empty-state">Failed to load host files.</p>';
  }
}

// 3. UXIOM Mesh Ring Management
async function joinMesh() {
  leaveBeaconSent = false;
  try {
    const isHost = isLocalHostPage();
    const res = await fetch('/api/mesh/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: myClientId,
        userAgent: navigator.userAgent,
        isHostDashboard: isHost
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        mySlot = data.slot;
        if (mySlotBadge) {
          mySlotBadge.textContent = mySlot === 'U' ? 'Assigned: [ U ] Host' : `Assigned: [ ${mySlot} ]`;
          mySlotBadge.classList.add('active');
        }
        if (data.ring) {
          renderRing(data.ring);
        }
      }
    }
  } catch (err) {
    console.warn('Mesh registration error:', err);
  }
}

const MESH_LAYOUT = {
  U: { x: 200, y: 112, left: '50%', top: '50%', isHub: true },
  X: { x: 78, y: 48, left: '19.5%', top: '21.4%', path: 'M 200 112 Q 142 54 78 48' },
  I: { x: 322, y: 48, left: '80.5%', top: '21.4%', path: 'M 200 112 Q 258 54 322 48' },
  O: { x: 78, y: 176, left: '19.5%', top: '78.6%', path: 'M 200 112 Q 142 170 78 176' },
  M: { x: 322, y: 176, left: '80.5%', top: '78.6%', path: 'M 200 112 Q 258 170 322 176' }
};

function renderRing(ring) {
  if (!meshRing) return;
  currentRingState = ring || [];
  meshRing.innerHTML = '';

  const nodeMap = {};
  currentRingState.forEach(n => { nodeMap[n.slot] = n; });

  const assignedPeersList = currentRingState.filter(n => n.slot !== 'U' && n.assigned);
  const assignedPeers = assignedPeersList.length;

  // Reset target cleanly if selected device disconnected, and sync host/peer auto-routing
  const targetNode = nodeMap[targetSlot];
  const targetDisconnected = (targetSlot !== 'U' && targetSlot !== 'ALL' && (!targetNode || !targetNode.assigned || targetSlot === mySlot));

  if (targetDisconnected) {
    userPickedTarget = false;
    if (mySlot === 'U' && assignedPeers > 0) {
      const firstPeer = assignedPeersList[0];
      targetSlot = firstPeer.slot;
      if (targetNodeText) targetNodeText.textContent = `[ ${firstPeer.slot} ] ${firstPeer.name}`;
      if (dropzoneActionText) dropzoneActionText.textContent = `Tap or Drag to Beam to [ ${firstPeer.slot} ] ${firstPeer.name}`;
    } else {
      targetSlot = 'U';
      if (targetNodeText) targetNodeText.textContent = '[ U ] Master Host';
      if (dropzoneActionText) dropzoneActionText.textContent = 'Tap or Drag Files to Stream';
    }
  } else if (mySlot === 'U' && !userPickedTarget) {
    if (assignedPeers > 0 && targetSlot === 'U') {
      const firstPeer = assignedPeersList[0];
      targetSlot = firstPeer.slot;
      if (targetNodeText) targetNodeText.textContent = `[ ${firstPeer.slot} ] ${firstPeer.name}`;
      if (dropzoneActionText) dropzoneActionText.textContent = `Tap or Drag to Beam to [ ${firstPeer.slot} ] ${firstPeer.name}`;
    } else if (assignedPeers === 0 && targetSlot !== 'U' && targetSlot !== 'ALL') {
      targetSlot = 'U';
      if (targetNodeText) targetNodeText.textContent = '[ U ] Master Host';
      if (dropzoneActionText) dropzoneActionText.textContent = 'Tap or Drag Files to Stream';
    }
  }

  const diagram = document.createElement('div');
  diagram.className = 'mesh-diagram';

  // True geometric circles in CSS (unaffected by container aspect differences across phone/laptop)
  const innerSonar = document.createElement('div');
  innerSonar.className = 'mesh-sonar-ring mesh-sonar-inner';
  diagram.appendChild(innerSonar);
  const outerSonar = document.createElement('div');
  outerSonar.className = 'mesh-sonar-ring mesh-sonar-outer';
  diagram.appendChild(outerSonar);

  // SVG Hub & Spoke Linking Layer
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'mesh-links-svg');
  svg.setAttribute('viewBox', '0 0 400 224');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const guideHtml = [
    '<path d="M 78 48 L 322 48 L 322 176 L 78 176 Z" class="mesh-link-perimeter" />'
  ];

  ['X', 'I', 'O', 'M'].forEach(slot => {
    const pos = MESH_LAYOUT[slot];
    const node = nodeMap[slot] || { slot, assigned: false };
    const isArmed =
      (node.assigned && targetSlot === 'ALL') ||
      (mySlot === 'U' && targetSlot === slot && node.assigned) ||
      (mySlot === slot && targetSlot === 'U') ||
      (mySlot === slot && targetSlot !== 'U' && targetSlot !== slot) ||
      (targetSlot === slot && mySlot !== 'U' && node.assigned);

    const linkClass = isArmed
      ? 'mesh-link-path mesh-link-armed'
      : (node.assigned ? 'mesh-link-path mesh-link-online' : 'mesh-link-path mesh-link-idle');

    guideHtml.push(`<path d="${pos.path}" class="${linkClass}" />`);
    if (isArmed) {
      guideHtml.push(`<circle cx="${pos.x}" cy="${pos.y}" r="4" class="mesh-link-endpoint" />`);
    }
  });

  svg.innerHTML = guideHtml.join('');
  diagram.appendChild(svg);

  // Interactive Nodes anchored to SVG endpoints
  currentRingState.forEach(node => {
    const pos = MESH_LAYOUT[node.slot];
    if (!pos) return;

    const isSelf = (node.slot === mySlot);
    const isTarget = (node.slot === targetSlot);
    const rawName = node.assigned ? node.name.replace(/\s*\(Host\)\s*$/i, '') : 'Waiting';
    const shortName = rawName.length > 22 ? rawName.slice(0, 20) + '...' : rawName;
    const safeNodeName = escapeHtml(shortName);
    const safeFullTitle = escapeHtml(node.assigned ? node.name : 'Waiting');
    const safeSlot = escapeHtml(node.slot);

    const nodeEl = document.createElement('button');
    nodeEl.type = 'button';
    nodeEl.className = 'mesh-node';
    if (pos.isHub) nodeEl.classList.add('mesh-node-hub');
    if (node.assigned) nodeEl.classList.add('mesh-node-active');
    if (isSelf) nodeEl.classList.add('mesh-node-self');
    if (isTarget) nodeEl.classList.add('mesh-node-selected');
    nodeEl.style.left = pos.left;
    nodeEl.style.top = pos.top;

    if (isSelf || (!node.assigned && node.slot !== 'U')) {
      nodeEl.disabled = true;
    }

    nodeEl.innerHTML = `
      ${isSelf ? '<span class="self-tag">YOU</span>' : ''}
      <span class="mesh-node-head">
        <span class="mesh-node-dot ${node.assigned ? 'online' : ''}"></span>
        <span class="mesh-node-letter">[ ${safeSlot} ]</span>
      </span>
      <span class="mesh-node-device" title="${safeFullTitle}">${safeNodeName}</span>
    `;

    if (!isSelf && node.assigned) {
      nodeEl.addEventListener('click', () => {
        userPickedTarget = true;
        selectTarget(node.slot, `[ ${node.slot} ] ${node.name}`);
      });
    } else if (!isSelf && !node.assigned && node.slot === 'U') {
      nodeEl.addEventListener('click', () => {
        userPickedTarget = true;
        selectTarget('U', '[ U ] Master Host');
      });
    }

    diagram.appendChild(nodeEl);
  });

  meshRing.appendChild(diagram);

  // Full-width Broadcast Pill below Linking Diagram
  const isSwarmTarget = (targetSlot === 'ALL');
  const swarmEl = document.createElement('button');
  swarmEl.type = 'button';
  swarmEl.className = 'mesh-all-pill' + (isSwarmTarget ? ' selected' : '');
  swarmEl.innerHTML = `
    <span class="mesh-all-left">
      <span class="mesh-node-letter">[ ALL ]</span>
      <span>Broadcast to All Connected Devices</span>
    </span>
    <span class="mesh-all-count">${assignedPeers} peer${assignedPeers === 1 ? '' : 's'} linked</span>
  `;
  swarmEl.addEventListener('click', () => {
    userPickedTarget = true;
    selectTarget('ALL', '[ ALL ] All Connected Devices');
  });
  meshRing.appendChild(swarmEl);
}

function selectTarget(slot, label) {
  targetSlot = slot;
  if (targetNodeText) targetNodeText.textContent = label;
  if (dropzoneActionText) {
    dropzoneActionText.textContent = `Tap or Drag to Beam to ${label}`;
  }
  renderRing(currentRingState);
}

// 4. SSE Real-Time Event Stream
function connectMeshEvents() {
  if (meshEventSource) {
    try { meshEventSource.close(); } catch {}
  }
  const streamUrl = `/api/mesh/events?clientId=${encodeURIComponent(myClientId || '')}`;
  meshEventSource = new EventSource(streamUrl);

  meshEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'ring_update') {
        const prevCount = currentRingState.filter(n => n.assigned && !n.isHost).length;
        const nextCount = Array.isArray(data.ring) ? data.ring.filter(n => n.assigned && !n.isHost).length : 0;
        renderRing(data.ring);
        if (nextCount > prevCount) {
          dismantleModalOnConnect('Device Connected');
        }
      } else if (data.type === 'qr_scanned') {
        dismantleModalOnConnect('Phone Redirecting...');
      } else if (data.type === 'incoming_mesh_transfer') {
        handleIncomingMeshTransfer(data.transfer);
      } else if (data.type === 'host_transfer_start') {
        handleHostTransferStart(data);
      } else if (data.type === 'host_transfer_progress') {
        handleHostTransferProgress(data);
      } else if (data.type === 'host_transfer_complete') {
        handleHostTransferComplete(data);
      } else if (data.type === 'host_transfer_cancel') {
        handleHostTransferCancel(data);
      } else if (data.type === 'outbound_updated') {
        loadHostFiles();
      } else if (data.type === 'open_qr_modal') {
        openQrModal();
      }
    } catch (err) {
      console.error('SSE Message error:', err);
    }
  };

  meshEventSource.onerror = () => {
    // Browser auto-reconnects SSE
  };
}

async function reconcileMeshPresence() {
  if (!myClientId) return;
  leaveBeaconSent = false;
  if (!meshEventSource || meshEventSource.readyState === 2) {
    connectMeshEvents();
  }
  const stillAssigned = isLocalHostPage() || currentRingState.length === 0 || currentRingState.some(n => n.assigned && n.clientId === myClientId);
  if (!stillAssigned) {
    await joinMesh();
    return;
  }
  try {
    await fetch('/api/mesh/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: myClientId })
    });
  } catch {}
}

// =========================================================
// Apple Liquid Glass Dynamic Island Logic
// =========================================================
function setIslandState(state) {
  if (!dynamicIsland) return;
  dynamicIsland.classList.remove('state-idle', 'state-receiving', 'state-complete');
  dynamicIsland.classList.add(state);
}

function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!islandAudioCtx) islandAudioCtx = new AudioCtx();
    if (islandAudioCtx.state === 'suspended') {
      islandAudioCtx.resume();
    }
    const now = islandAudioCtx.currentTime;

    const playTone = (freq, start, duration, gainVal = 0.16) => {
      const osc = islandAudioCtx.createOscillator();
      const gain = islandAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(gainVal, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(islandAudioCtx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    // Apple-style two-tone warm chime (E5 -> C6)
    playTone(659.25, now, 0.22, 0.15);
    playTone(1046.50, now + 0.10, 0.40, 0.20);
  } catch (err) {
    // Silent fail if browser prevents unmuted audio without prior touch
  }
}

function handleHostTransferStart(data) {
  if (islandRevertTimer) clearTimeout(islandRevertTimer);

  currentHostTransfer = {
    fileId: data.fileId,
    fileName: data.fileName,
    fileSize: data.fileSize || 0,
    totalChunks: data.totalChunks || 1,
    fromSlot: data.fromSlot || 'Node',
    queueIndex: data.queueIndex || 1,
    totalFiles: data.totalFiles || 1,
    startTime: Date.now(),
    lastBytes: 0,
    lastTime: Date.now()
  };

  if (data.totalFiles && data.totalFiles > 1) {
    if (islandFileName) islandFileName.textContent = `[${data.queueIndex}/${data.totalFiles}] ${data.fileName}`;
    if (islandFromNode) islandFromNode.textContent = `[ ${data.fromSlot || 'Node'} ] Queue ${data.queueIndex}/${data.totalFiles}`;
  } else {
    if (islandFileName) islandFileName.textContent = data.fileName;
    if (islandFromNode) islandFromNode.textContent = `[ ${data.fromSlot || 'Node'} ]`;
  }

  if (islandSpeed) islandSpeed.textContent = 'Streaming...';
  if (islandProgressBar) islandProgressBar.style.width = '0%';
  if (islandPercent) islandPercent.textContent = '0%';

  setIslandState('state-receiving');
}

function handleHostTransferProgress(data) {
  if (!currentHostTransfer || currentHostTransfer.fileId !== data.fileId) {
    currentHostTransfer = {
      fileId: data.fileId,
      fileSize: data.totalBytes || 0,
      totalChunks: data.totalChunks || 1,
      startTime: Date.now(),
      lastBytes: 0,
      lastTime: Date.now()
    };
  }

  const totalBytes = data.totalBytes || currentHostTransfer.fileSize || 0;
  const hasByteProgress = (typeof data.receivedBytes === 'number' && totalBytes > 0);
  const percent = hasByteProgress
    ? Math.min(100, Math.round((data.receivedBytes / totalBytes) * 100))
    : Math.min(100, Math.round((data.receivedTotal / (data.totalChunks || 1)) * 100));

  if (islandProgressBar) islandProgressBar.style.width = `${percent}%`;
  if (islandPercent) islandPercent.textContent = `${percent}%`;

  const currentBytes = hasByteProgress
    ? data.receivedBytes
    : (currentHostTransfer.fileSize ? (data.receivedTotal / currentHostTransfer.totalChunks) * currentHostTransfer.fileSize : 0);

  if (currentBytes > 0) {
    const now = Date.now();
    const elapsed = (now - currentHostTransfer.lastTime) / 1000;
    if (elapsed >= 0.4) {
      const delta = currentBytes - currentHostTransfer.lastBytes;
      const speedMb = (delta / (1024 * 1024 * elapsed)).toFixed(1);
      if (islandSpeed && Number(speedMb) > 0) islandSpeed.textContent = `${speedMb} MB/s`;
      currentHostTransfer.lastBytes = currentBytes;
      currentHostTransfer.lastTime = now;
    }
  }
}

function handleHostTransferCancel(data) {
  if (!currentHostTransfer || currentHostTransfer.fileId === data.fileId) {
    currentHostTransfer = null;
    if (islandRevertTimer) clearTimeout(islandRevertTimer);
    setIslandState('state-idle');
  }
}

function handleHostTransferComplete(data) {
  lastReceivedFile = {
    fileName: data.fileName,
    filePath: data.filePath,
    fileSize: data.fileSize
  };

  if (islandCompleteName) islandCompleteName.textContent = data.fileName;
  if (islandCompleteSize) islandCompleteSize.textContent = formatBytes(data.fileSize);

  setIslandState('state-complete');
  playSuccessChime();

  const isHostViewer = isLocalHostPage();
  const isDirectHostTarget = data.toSlot === 'U' || !data.toSlot;
  if (isHostViewer && isDirectHostTarget) {
    const ctx = getClientFileContext(data.fileName, data);
    showReceiveToast({
      title: 'File Received on PC',
      fileName: data.fileName,
      meta: `From [ ${data.fromSlot || 'Peer'} ] • ${formatBytes(data.fileSize)} • Saved to Downloads\\uDrop`,
      badge: ctx.badge,
      category: ctx.category,
      actionLabel: 'Show',
      actionIcon: 'folder-open',
      onAction: () => {
        fetch('/api/open-file', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: data.filePath, fileName: data.fileName })
        }).then(res => {
          if (!res.ok) {
            return fetch('/api/open-folder', { method: 'POST', keepalive: true });
          }
        }).catch(() => {
          fetch('/api/open-folder', { method: 'POST', keepalive: true }).catch(() => {});
        });
      }
    });
  }

  // Refresh files list in dashboard
  loadHostFiles();

  // Return to idle state after 8 seconds
  if (islandRevertTimer) clearTimeout(islandRevertTimer);
  islandRevertTimer = setTimeout(() => {
    setIslandState('state-idle');
  }, 8000);
}

// Dynamic Island Button Listeners
if (islandOpenFolderBtn) {
  islandOpenFolderBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const origHtml = islandOpenFolderBtn.innerHTML;
      islandOpenFolderBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Opened!</span>
      `;
      await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: lastReceivedFile?.filePath,
          fileName: lastReceivedFile?.fileName
        })
      });
      setTimeout(() => {
        islandOpenFolderBtn.innerHTML = origHtml;
      }, 2000);
    } catch (err) {
      console.warn('Failed to open file in Explorer:', err);
    }
  });
}

if (islandDismissBtn) {
  islandDismissBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (islandRevertTimer) clearTimeout(islandRevertTimer);
    setIslandState('state-idle');
  });
}

const openIslandPopoutBtn = document.getElementById('openIslandPopoutBtn');
if (openIslandPopoutBtn) {
  openIslandPopoutBtn.addEventListener('click', () => {
    window.open('/island', 'uDropIsland', 'width=520,height=160,menubar=no,toolbar=no,location=no,status=no');
  });
}

if (dynamicIsland) {
  dynamicIsland.addEventListener('click', (e) => {
    // If clicked on [ U ] badge in idle state, open Liquid Glass QR modal
    if (e.target && e.target.classList.contains('island-badge')) {
      e.stopPropagation();
      openQrModal();
      return;
    }
    // If clicked while in idle state, open uDrop download folder
    if (dynamicIsland.classList.contains('state-idle')) {
      fetch('/api/open-folder', { method: 'POST' }).catch(() => {});
    }
  });
}

// =========================================================
// Apple Liquid Glass Optical Pairing Modal Logic
// =========================================================
const qrGlassModal = document.getElementById('qrGlassModal');
const openQrModalBtn = document.getElementById('openQrModalBtn');
const closeQrModalBtn = document.getElementById('closeQrModalBtn');
const qrModalBackdrop = document.getElementById('qrModalBackdrop');
const glassQrCanvas = document.getElementById('glassQrCanvas');

let kineticModalQr = (glassQrCanvas && typeof window.createKineticQr === 'function')
  ? window.createKineticQr(glassQrCanvas)
  : null;
let isDismantlingModal = false;

if (kineticModalQr && typeof kineticModalQr.prefetch === 'function') {
  kineticModalQr.prefetch();
}

function openQrModal() {
  if (!qrGlassModal) return;
  isDismantlingModal = false;
  qrGlassModal.classList.remove('hidden');
  qrGlassModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (kineticModalQr) {
    kineticModalQr.assemble();
  }
}

function closeQrModal() {
  if (!qrGlassModal) return;
  isDismantlingModal = false;
  qrGlassModal.classList.add('hidden');
  qrGlassModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function dismantleModalOnConnect(label) {
  if (!qrGlassModal || qrGlassModal.classList.contains('hidden') || isDismantlingModal) return;
  isDismantlingModal = true;
  if (kineticModalQr) {
    kineticModalQr.disassemble(label || 'Device Connected', () => {
      setTimeout(() => closeQrModal(), 360);
    });
  } else {
    closeQrModal();
  }
}

if (openQrModalBtn) {
  openQrModalBtn.addEventListener('click', openQrModal);
}

if (closeQrModalBtn) {
  closeQrModalBtn.addEventListener('click', closeQrModal);
}

if (qrModalBackdrop) {
  qrModalBackdrop.addEventListener('click', closeQrModal);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && qrGlassModal && !qrGlassModal.classList.contains('hidden')) {
    closeQrModal();
  }
});

// Auto-open modal if requested via URL (?pair, ?qr) or hash #qr
if (window.location.search.includes('pair') || window.location.search.includes('qr') || window.location.hash === '#qr') {
  setTimeout(openQrModal, 120);
}

let activeIncomingTransfer = null;

function handleIncomingMeshTransfer(transfer) {
  // If sent by this device, ignore
  if (transfer.fromSlot === mySlot) return;

  // If targeted specifically to someone else, ignore
  if (transfer.toSlot !== 'ALL' && transfer.toSlot !== mySlot) return;

  if (incomingTransferCard) {
    const ctx = getClientFileContext(transfer.fileName, transfer);
    activeIncomingTransfer = { ...transfer, ctx };

    incomingFromText.textContent = `From Node [ ${transfer.fromSlot} ] -> [ ${transfer.toSlot} ]`;
    incomingFileName.textContent = transfer.fileName;
    incomingFileSize.textContent = formatBytes(transfer.fileSize);
    if (incomingTypeBadge) incomingTypeBadge.textContent = ctx.badge;
    if (incomingDestHint) incomingDestHint.textContent = ctx.hint;

    if (incomingThumbBox) {
      incomingThumbBox.classList.remove('hidden', 'file-thumb-badge');
      if (ctx.category === 'photo') {
        incomingThumbBox.innerHTML = `<img src="${transfer.downloadUrl}?inline=1" class="file-thumb" alt="">`;
      } else {
        incomingThumbBox.classList.add('file-thumb-badge');
        incomingThumbBox.innerHTML = renderLucideSvg(getCategoryLucideName(ctx.category), 18, 1.9);
      }
    }

    if (incomingContextBtn) {
      if (ctx.actionLabel) {
        incomingContextBtn.innerHTML = `${renderLucideSvg(getActionLucideName(ctx, ctx.actionLabel), 13, 2.2)}<span>${escapeHtml(ctx.actionLabel)}</span>`;
        incomingContextBtn.classList.remove('hidden');
      } else {
        incomingContextBtn.classList.add('hidden');
      }
    }

    incomingDownloadBtn.href = transfer.downloadUrl;
    incomingDownloadBtn.setAttribute('download', transfer.fileName);
    incomingTransferCard.classList.remove('hidden');

    const toastActionLabel = ctx.actionLabel || 'Download';
    showReceiveToast({
      title: `File Received from [ ${transfer.fromSlot} ]`,
      fileName: transfer.fileName,
      meta: `${formatBytes(transfer.fileSize)} • ${ctx.hint}`,
      badge: ctx.badge,
      category: ctx.category,
      actionLabel: toastActionLabel,
      actionIcon: getActionLucideName(ctx, toastActionLabel),
      onAction: () => triggerContextSaveAction(transfer.downloadUrl, transfer.fileName, transfer.fileSize, ctx, receiveToastActionBtn)
    });
  }
}

if (incomingContextBtn) {
  incomingContextBtn.addEventListener('click', () => {
    if (!activeIncomingTransfer) return;
    triggerContextSaveAction(
      activeIncomingTransfer.downloadUrl,
      activeIncomingTransfer.fileName,
      activeIncomingTransfer.fileSize,
      activeIncomingTransfer.ctx,
      incomingContextBtn
    );
  });
}

if (dismissIncomingBtn) {
  dismissIncomingBtn.addEventListener('click', () => {
    if (incomingTransferCard) incomingTransferCard.classList.add('hidden');
  });
}

if (incomingDownloadBtn) {
  incomingDownloadBtn.addEventListener('click', () => {
    // Smooth auto-dismiss after download initiation
    setTimeout(() => {
      if (incomingTransferCard) incomingTransferCard.classList.add('hidden');
    }, 2500);
  });
}

// 5. Drag and Drop & Quick Action Pickers
if (pickMediaBtn && mediaInput) {
  pickMediaBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mediaInput.click();
  });
}

if (pickFilesBtn && fileInput) {
  pickFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
}

if (dropzone) {
  dropzone.addEventListener('click', (e) => {
    if (e.target && e.target.closest('#dropzoneQuickActions')) return;
    if (dropzone.classList.contains('dropzone-busy')) return;
    // On mobile devices, default to media gallery for fast video/photo selection
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile && mediaInput) {
      mediaInput.click();
    } else if (fileInput) {
      fileInput.click();
    }
  });
}

['dragenter', 'dragover'].forEach(name => {
  if (dropzone) {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
      if (mascotFace) mascotFace.textContent = '{- o -}';
    });
  }
});

['dragleave', 'drop'].forEach(name => {
  if (dropzone) {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  }
});

if (dropzone) {
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(Array.from(files));
    } else {
      if (mascotFace) mascotFace.textContent = '{- _ -}';
    }
  });
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(Array.from(fileInput.files));
    }
  });
}

if (mediaInput) {
  mediaInput.addEventListener('change', () => {
    if (mediaInput.files && mediaInput.files.length > 0) {
      handleFiles(Array.from(mediaInput.files));
    }
  });
}

if (refreshFilesBtn) {
  refreshFilesBtn.addEventListener('click', loadHostFiles);
}

// =========================================================
// Triple-Layer Mobile Screen Stay-Awake (HTTP Compatible)
// 1. navigator.wakeLock (HTTPS / Desktop)
// 2. Invisible Canvas Stream Video Player (iOS Safari / Android)
// 3. Silent WebAudio Oscillator (Background networking anchor)
// =========================================================
let appWakeLock = null;
let wakeCanvasStream = null;
let wakeAudioCtx = null;
let wakeOsc = null;

function startVideoWakeLock() {
  try {
    const video = document.getElementById('wakeLockVideo');
    if (!video) return;
    if (!wakeCanvasStream) {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-black').trim() || 'black';
      ctx.fillRect(0, 0, 2, 2);
      if (canvas.captureStream) {
        wakeCanvasStream = canvas.captureStream(1);
      }
    }
    if (wakeCanvasStream && video.srcObject !== wakeCanvasStream) {
      video.srcObject = wakeCanvasStream;
    }
    video.play().catch(() => {});
  } catch (e) {}
}

function stopVideoWakeLock() {
  try {
    const video = document.getElementById('wakeLockVideo');
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  } catch (e) {}
}

function startAudioKeepAlive() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!wakeAudioCtx) wakeAudioCtx = new AudioCtx();
    if (wakeAudioCtx.state === 'suspended') {
      wakeAudioCtx.resume().catch(() => {});
    }
    if (!wakeOsc) {
      const osc = wakeAudioCtx.createOscillator();
      const gain = wakeAudioCtx.createGain();
      gain.gain.value = 0.00001; // inaudible
      osc.connect(gain);
      gain.connect(wakeAudioCtx.destination);
      osc.start();
      wakeOsc = osc;
    }
  } catch (e) {}
}

function stopAudioKeepAlive() {
  try {
    if (wakeOsc) {
      wakeOsc.stop();
      wakeOsc.disconnect();
      wakeOsc = null;
    }
  } catch (e) {}
}

async function requestScreenWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      appWakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
  startVideoWakeLock();
  startAudioKeepAlive();
}

function releaseScreenWakeLock() {
  if (appWakeLock) {
    appWakeLock.release().catch(() => {});
    appWakeLock = null;
  }
  stopVideoWakeLock();
  stopAudioKeepAlive();
}

function combineSignals(sigA, sigB) {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([sigA, sigB].filter(Boolean));
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (sigA) {
    if (sigA.aborted) return sigA;
    sigA.addEventListener('abort', onAbort, { once: true });
  }
  if (sigB) {
    if (sigB.aborted) return sigB;
    sigB.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

const SMALL_FILE_THRESHOLD_BYTES = 3 * 1024 * 1024; // 3 MB

// Bandwidth Smartness & Dynamic Allocation
// Files < 3MB: Sent in parallel concurrent streams (fast multi-photo & document beam)
// Files >= 3MB: Sent single-by-single through a dedicated 100% bandwidth pipe (0 Wi-Fi airtime contention)
function getOptimalChunkConfig(fileSize, totalFiles = 1, isParallelSlot = false) {
  if (fileSize < SMALL_FILE_THRESHOLD_BYTES) {
    return {
      chunkSize: Math.max(1, fileSize),
      concurrency: 1,
      mode: isParallelSlot || totalFiles > 1 ? 'Parallel Multi-Stream (<3 MB)' : 'Dedicated Fast Pipe'
    };
  }

  // Files >= 3MB: strictly single-by-single dedicated transfer
  if (fileSize <= 64 * 1024 * 1024) {
    return {
      chunkSize: Math.max(1, fileSize),
      concurrency: 1,
      mode: 'Dedicated Full-Bandwidth Pipe (Single Transfer)'
    };
  }
  if (fileSize <= 256 * 1024 * 1024) {
    return {
      chunkSize: 32 * 1024 * 1024,
      concurrency: 1,
      mode: 'High-Bandwidth Dedicated Pipe (Single Transfer)'
    };
  }
  return {
    chunkSize: 16 * 1024 * 1024,
    concurrency: 1,
    mode: 'Dedicated High-Speed Pipe (Single Transfer)'
  };
}

function getOptimalChunkSize(fileSize, totalFiles = 1, isParallelSlot = false) {
  return getOptimalChunkConfig(fileSize, totalFiles, isParallelSlot).chunkSize;
}

/**
 * Streams a binary chunk over XHR so single-file dedicated-pipe transfers emit
 * real-time upload progress and rely on an inactivity watchdog rather than a fixed timeout.
 */
function uploadChunkViaXHR(url, blob, signal, onProgress, inactivityMs = 25000) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      const err = new Error('Transfer aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }

    const xhr = new XMLHttpRequest();
    let stalled = false;
    let settled = false;
    let lastLoaded = 0;
    let stallTimer = null;

    const cleanup = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (signal) signal.removeEventListener('abort', onSignalAbort);
    };

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, inactivityMs);
    };

    const onSignalAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      xhr.abort();
      const err = new Error('Transfer aborted');
      err.name = 'AbortError';
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', onSignalAbort, { once: true });
    }

    xhr.open('PUT', url, true);
    resetStallTimer();

    xhr.upload.onprogress = (e) => {
      if (settled) return;
      if (e.loaded > lastLoaded) {
        lastLoaded = e.loaded;
        resetStallTimer();
      }
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded);
      }
    };

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Chunk upload failed with HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Network error during chunk upload'));
    };

    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (stalled) {
        reject(new Error('Chunk upload stalled (inactivity timeout)'));
      } else {
        const err = new Error('Transfer aborted');
        err.name = 'AbortError';
        reject(err);
      }
    };

    xhr.send(blob);
  });
}

// Cancel Transfer Event Listener
if (cancelTransferBtn) {
  cancelTransferBtn.addEventListener('click', async () => {
    isCurrentTransferCancelled = true;
    isProcessingQueue = false;
    const idsToCancel = Array.from(activeUploadSessions.keys());

    for (const ctrl of activeUploadSessions.values()) {
      try {
        ctrl.abort();
      } catch (e) {}
    }
    activeUploadSessions.clear();

    // Immediately purge queue and state so re-transfers start completely fresh
    activeBatchQueue = [];
    if (queueItemsList) queueItemsList.innerHTML = '';
    if (batchSummaryBar) batchSummaryBar.classList.add('hidden');
    if (queueListWrapper) queueListWrapper.classList.add('hidden');
    if (fileInput) { fileInput.value = ''; fileInput.disabled = false; }
    if (mediaInput) { mediaInput.value = ''; mediaInput.disabled = false; }
    releaseScreenWakeLock();

    transferStatus.textContent = 'Transfer cancelled.';
    transferStatus.style.color = 'var(--status-red)';
    transferSpeed.textContent = 'Cancelled';
    transferEta.textContent = '--:--';
    cancelTransferBtn.style.display = 'none';

    if (idsToCancel.length > 0) {
      await Promise.allSettled(
        idsToCancel.map(id => fetch(`/api/upload/cancel/${encodeURIComponent(id)}`, { method: 'POST' }))
      );
    }

    if (dropzone) {
      dropzone.classList.remove('dropzone-busy');
      if (dropzoneActionText) dropzoneActionText.textContent = 'Tap or Drag Files to Stream';
    }

    setTimeout(() => {
      transferContainer.classList.add('hidden');
      cancelTransferBtn.style.display = '';
      transferStatus.style.color = '';
      progressBar.style.width = '0%';
    }, 1200);
  });
}

// =========================================================
// 6. Resilient Multi-Video Batch Queue Engine
// =========================================================
let activeBatchQueue = [];
let isProcessingQueue = false;

async function handleFiles(newFiles) {
  if (!newFiles || newFiles.length === 0) return;

  // If previous queue is completed or stopped, ALWAYS clean the slate!
  if (!isProcessingQueue) {
    activeBatchQueue = [];
    if (queueItemsList) queueItemsList.innerHTML = '';
    if (batchSummaryBar) batchSummaryBar.classList.add('hidden');
    if (queueListWrapper) queueListWrapper.classList.add('hidden');
    if (retryFailedBtn) retryFailedBtn.classList.add('hidden');
    progressBar.style.width = '0%';
    if (batchProgressBar) batchProgressBar.style.width = '0%';
  }

  // Immediate UI feedback on selection
  if (dropzoneActionText) {
    dropzoneActionText.textContent = `Preparing ${newFiles.length} item${newFiles.length > 1 ? 's' : ''}...`;
  }
  if (dropzone) {
    dropzone.classList.add('dropzone-busy');
  }

  // Request screen stay-awake immediately
  await requestScreenWakeLock();

  isCurrentTransferCancelled = false;

  const startIndex = activeBatchQueue.length;
  const itemsToAdd = newFiles.map((file, i) => ({
    id: startIndex + i,
    file,
    name: file.name || `Video_${startIndex + i + 1}.mp4`,
    size: file.size || 0,
    status: 'waiting',
    progress: 0,
    uploadedBytes: 0
  }));

  activeBatchQueue.push(...itemsToAdd);

  if (isProcessingQueue) {
    renderQueueList();
    updateBatchProgress();
    return;
  }

  isProcessingQueue = true;
  await processBatchQueue();
}

function renderQueueList() {
  if (!queueItemsList) return;
  queueItemsList.innerHTML = '';

  activeBatchQueue.forEach(item => {
    const el = document.createElement('div');
    el.className = `queue-item ${item.status === 'uploading' ? 'active' : ''}`;

    let statusText = 'Waiting';
    let statusClass = 'waiting';
    if (item.status === 'uploading') {
      statusText = item.progress > 0 ? `${item.progress}%` : 'Sending';
      statusClass = 'uploading';
    } else if (item.status === 'done') {
      statusText = 'Done';
      statusClass = 'done';
    } else if (item.status === 'failed') {
      statusText = 'Failed';
      statusClass = 'failed';
    }

    const safeItemName = escapeHtml(item.name);
    el.innerHTML = `
      <div class="queue-item-info">
        <span class="queue-item-name" title="${safeItemName}">${safeItemName}</span>
        <span class="queue-item-size">${formatBytes(item.size)}</span>
      </div>
      <span class="queue-status-pill ${statusClass}" id="queuePill_${item.id}">${statusText}</span>
    `;
    queueItemsList.appendChild(el);
  });
}

function updateBatchProgress() {
  if (!batchProgressBar || !batchCountBadge || !batchProgressStats) return;
  const total = activeBatchQueue.length;
  const completed = activeBatchQueue.filter(i => i.status === 'done').length;
  const totalBytes = activeBatchQueue.reduce((acc, i) => acc + i.size, 0);
  const uploadedBytes = activeBatchQueue.reduce((acc, i) => acc + (i.uploadedBytes || 0), 0);

  batchCountBadge.textContent = `${completed} / ${total}`;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
  batchProgressBar.style.width = `${pct}%`;
  batchProgressStats.textContent = `${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)} (${pct}%)`;
}

let aggregateSample = { bytes: 0, time: Date.now(), lastSpeedMb: '' };

function refreshAggregateProgressUI(force = false) {
  const uploadingItems = activeBatchQueue.filter(i => i.status === 'uploading');
  if (uploadingItems.length <= 1) return;

  const now = Date.now();
  const totalBytes = activeBatchQueue.reduce((acc, i) => acc + i.size, 0);
  const uploadedBytes = activeBatchQueue.reduce((acc, i) => acc + (i.uploadedBytes || 0), 0);
  const pct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 100;

  if (!force && (now - aggregateSample.time < 180)) {
    progressBar.style.width = `${pct}%`;
    return;
  }

  const dt = (now - aggregateSample.time) / 1000;
  if (dt >= 0.45) {
    const delta = Math.max(0, uploadedBytes - aggregateSample.bytes);
    const speedBps = delta / dt;
    aggregateSample.lastSpeedMb = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
    aggregateSample.bytes = uploadedBytes;
    aggregateSample.time = now;

    const remaining = Math.max(0, totalBytes - uploadedBytes);
    const etaSec = speedBps > 0 ? Math.ceil(remaining / speedBps) : 0;
    const etaMin = Math.floor(etaSec / 60);
    const etaRem = etaSec % 60;
    transferEta.textContent = `${etaMin}:${etaRem < 10 ? '0' : ''}${etaRem}`;
  }

  transferFileName.textContent = `Parallel Streaming (${uploadingItems.length} files active)`;
  transferStats.textContent = `${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`;
  if (aggregateSample.lastSpeedMb) transferSpeed.textContent = aggregateSample.lastSpeedMb;
  progressBar.style.width = `${pct}%`;
  transferChunks.textContent = `Parallel Mode (<3 MB) • ${uploadingItems.length} Concurrent Streams`;
  transferStatus.textContent = `Streaming ${uploadingItems.length} files simultaneously across LAN...`;
}

async function runQueueItemWithRetry(item, totalFiles, isParallelSlot) {
  if (isCurrentTransferCancelled || item.status === 'done') return item.status === 'done';

  item.status = 'uploading';
  renderQueueList();

  const pill = document.getElementById(`queuePill_${item.id}`);
  if (pill && pill.parentElement) {
    pill.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok && !isCurrentTransferCancelled; attempt++) {
    if (attempt > 1) {
      if (!isParallelSlot) {
        transferStatus.textContent = `Retrying item ${item.id + 1} of ${totalFiles} (Attempt ${attempt}/2)... transfer will resume.`;
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    ok = await uploadFileChunked(item.file, item.id + 1, totalFiles, (bytes, size, pct) => {
      item.uploadedBytes = bytes;
      item.progress = pct;
      updateBatchProgress();
      const activePill = document.getElementById(`queuePill_${item.id}`);
      if (activePill) activePill.textContent = `${pct}%`;
      if (isParallelSlot) {
        refreshAggregateProgressUI(false);
      }
    }, isParallelSlot);
  }

  if (isCurrentTransferCancelled) return false;

  if (ok) {
    item.status = 'done';
    item.progress = 100;
    item.uploadedBytes = item.size;
  } else {
    item.status = 'failed';
  }

  renderQueueList();
  updateBatchProgress();
  return ok;
}

async function processBatchQueue() {
  renderQueueList();
  transferContainer.classList.remove('hidden');

  const totalFiles = activeBatchQueue.length;
  if (totalFiles > 1) {
    if (batchSummaryBar) batchSummaryBar.classList.remove('hidden');
    if (queueListWrapper) queueListWrapper.classList.remove('hidden');
  }

  updateBatchProgress();
  aggregateSample = { bytes: 0, time: Date.now(), lastSpeedMb: '' };

  let successCount = 0;
  let failedCount = 0;

  while (!isCurrentTransferCancelled) {
    const waiting = activeBatchQueue.filter(i => i.status === 'waiting');
    if (waiting.length === 0) break;

    const smallWaiting = waiting.filter(i => i.size < SMALL_FILE_THRESHOLD_BYTES);
    const largeWaiting = waiting.filter(i => i.size >= SMALL_FILE_THRESHOLD_BYTES);

    // 1. Small files (< 3MB): run in parallel concurrent streams (or single if only 1 remains)
    if (smallWaiting.length > 0) {
      if (smallWaiting.length === 1) {
        const ok = await runQueueItemWithRetry(smallWaiting[0], activeBatchQueue.length, false);
        if (ok) successCount++; else if (!isCurrentTransferCancelled) failedCount++;
        await new Promise(r => setTimeout(r, 60));
        continue;
      }

      // Stream small files concurrently across 3 parallel workers
      const parallelSlots = Math.min(3, smallWaiting.length);
      async function parallelWorker() {
        while (!isCurrentTransferCancelled) {
          const nextSmall = activeBatchQueue.find(i => i.status === 'waiting' && i.size < SMALL_FILE_THRESHOLD_BYTES);
          if (!nextSmall) break;
          const ok = await runQueueItemWithRetry(nextSmall, activeBatchQueue.length, true);
          if (ok) successCount++; else if (!isCurrentTransferCancelled) failedCount++;
          await new Promise(r => setTimeout(r, 60));
        }
      }

      await Promise.all(Array.from({ length: parallelSlots }, () => parallelWorker()));
      continue;
    }

    // 2. Large files (>= 3MB): run strictly single-by-single with 100% channel bandwidth
    if (largeWaiting.length > 0) {
      const nextLarge = largeWaiting[0];
      const ok = await runQueueItemWithRetry(nextLarge, activeBatchQueue.length, false);
      if (ok) successCount++; else if (!isCurrentTransferCancelled) failedCount++;
      await new Promise(r => setTimeout(r, 80));
      continue;
    }
  }

  successCount = activeBatchQueue.filter(i => i.status === 'done').length;
  failedCount = activeBatchQueue.filter(i => i.status === 'failed').length;

  isProcessingQueue = false;
  releaseScreenWakeLock();

  // Reset inputs
  if (fileInput) { fileInput.value = ''; fileInput.disabled = false; }
  if (mediaInput) { mediaInput.value = ''; mediaInput.disabled = false; }
  if (dropzone) {
    dropzone.classList.remove('dropzone-busy');
    if (dropzoneActionText) dropzoneActionText.textContent = 'Tap or Drag Files to Stream';
  }

  if (!isCurrentTransferCancelled) {
    if (failedCount > 0) {
      transferStatus.textContent = `Queue completed: ${successCount} sent, ${failedCount} failed.`;
      transferStatus.style.color = 'var(--status-red)';
      if (retryFailedBtn) {
        retryFailedBtn.classList.remove('hidden');
        const text = document.getElementById('retryFailedBtnText');
        if (text) text.textContent = `Retry ${failedCount} Failed`;
      }
    } else {
      transferStatus.textContent = `All ${activeBatchQueue.length} file${activeBatchQueue.length > 1 ? 's' : ''} transferred successfully.`;
      transferStatus.style.color = 'var(--status-green)';
      if (retryFailedBtn) retryFailedBtn.classList.add('hidden');

      setTimeout(() => {
        if (!isProcessingQueue) {
          transferContainer.classList.add('hidden');
          if (batchSummaryBar) batchSummaryBar.classList.add('hidden');
          if (queueListWrapper) queueListWrapper.classList.add('hidden');
          activeBatchQueue = [];
          if (queueItemsList) queueItemsList.innerHTML = '';
          transferStatus.style.color = '';
        }
      }, 3500);
    }
  }
}

if (retryFailedBtn) {
  retryFailedBtn.addEventListener('click', async () => {
    if (isProcessingQueue) return;
    retryFailedBtn.classList.add('hidden');
    activeBatchQueue.forEach(item => {
      if (item.status === 'failed') {
        item.status = 'waiting';
        item.progress = 0;
        item.uploadedBytes = 0;
      }
    });
    isProcessingQueue = true;
    await requestScreenWakeLock();
    await processBatchQueue();
  });
}

/**
 * Uploads a large file using tuned sparse chunk streaming & auto-resume.
 */
async function uploadFileChunked(file, queueIndex = 1, totalFiles = 1, onProgress = null, isParallelSlot = false) {
  if (isCurrentTransferCancelled) return false;

  const config = getOptimalChunkConfig(file.size, totalFiles, isParallelSlot);
  const chunkSize = config.chunkSize;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const randTag = Math.random().toString(36).substring(2, 7);
  const cleanBase = (file.name || 'video.mp4').replace(/[^a-zA-Z0-9._\- ()]/g, '_');
  const fileId = `${cleanBase}_${file.size}_${file.lastModified || Date.now()}_${randTag}`.replace(/[^a-zA-Z0-9_]/g, '_');

  const abortController = new AbortController();
  activeUploadSessions.set(fileId, abortController);
  const ownsMainPanel = () => activeUploadSessions.size <= 1;

  try {
    transferContainer.classList.remove('hidden');
    if (cancelTransferBtn) cancelTransferBtn.style.display = '';

    if (ownsMainPanel()) {
      transferFileName.textContent = totalFiles > 1 ? `[${queueIndex}/${totalFiles}] ${file.name || cleanBase}` : (file.name || cleanBase);
      transferStats.textContent = `0 B / ${formatBytes(file.size)}`;
      transferSpeed.textContent = 'Connecting...';
      transferEta.textContent = '--:--';
      progressBar.style.width = '0%';
      transferChunks.textContent = totalFiles > 1
        ? `${config.mode} • Item ${queueIndex}/${totalFiles}`
        : (totalChunks === 1 ? 'Dedicated 100% Bandwidth Pipe' : `Dedicated Stream • Chunk 0/${totalChunks}`);
      transferStatus.textContent = totalFiles > 1
        ? `Preparing item ${queueIndex} of ${totalFiles} (${config.mode})...`
        : (totalChunks === 1 ? 'Allocating 100% bandwidth to single file...' : 'Initializing dedicated stream...');
    }

    // Step 1: Initialize sparse session on host with 25s timeout
    let initRes;
    try {
      const initCtrl = new AbortController();
      const initTimer = setTimeout(() => initCtrl.abort(), 25000);
      const combinedSignal = combineSignals(abortController.signal, initCtrl.signal);

      recentlyUploadedNames.set(file.name || cleanBase, Date.now());
      initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: combinedSignal,
        body: JSON.stringify({
          fileId,
          fileName: file.name || cleanBase,
          fileSize: file.size,
          totalChunks,
          chunkSize,
          fromSlot: mySlot || 'Node',
          queueIndex,
          totalFiles
        })
      });
      clearTimeout(initTimer);
    } catch (e) {
      if (isCurrentTransferCancelled) return false;
    }

    if (!initRes || !initRes.ok) {
      if (isCurrentTransferCancelled) return false;
      if (ownsMainPanel()) transferStatus.textContent = 'Failed to initialize session.';
      return false;
    }

    // Step 2: Check existing status (auto-resume)
    let receivedSet = new Set();
    try {
      const statusRes = await fetch(`/api/upload/status/${fileId}`, {
        signal: abortController.signal
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        receivedSet = new Set(statusData.receivedChunks);
      }
    } catch (e) {}

    let completedBytes = 0;
    receivedSet.forEach((idx) => {
      const cStart = idx * chunkSize;
      const cEnd = Math.min(file.size, cStart + chunkSize);
      completedBytes += (cEnd - cStart);
    });

    const inFlightBytes = new Map();
    let startTime = Date.now();
    let lastBytes = completedBytes;
    let lastUiUpdate = 0;

    function updateProgressUI(force = false) {
      let activeTotal = 0;
      inFlightBytes.forEach((val) => { activeTotal += val; });
      const bytesUploaded = Math.min(file.size, completedBytes + activeTotal);

      const now = Date.now();
      if (!force && (now - lastUiUpdate < 120)) return;
      lastUiUpdate = now;

      const percent = file.size > 0 ? Math.min(100, Math.round((bytesUploaded / file.size) * 100)) : 100;

      if (ownsMainPanel()) {
        const elapsedSec = (now - startTime) / 1000;
        if (elapsedSec >= 0.45) {
          const deltaBytes = bytesUploaded - lastBytes;
          if (deltaBytes >= 0) {
            const speedBps = deltaBytes / elapsedSec;
            transferSpeed.textContent = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;

            const remainingBytes = Math.max(0, file.size - bytesUploaded);
            const etaSec = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
            const etaMin = Math.floor(etaSec / 60);
            const etaRemSec = etaSec % 60;
            transferEta.textContent = `${etaMin}:${etaRemSec < 10 ? '0' : ''}${etaRemSec}`;
          }
          lastBytes = bytesUploaded;
          startTime = now;
        }

        progressBar.style.width = `${percent}%`;
        transferStats.textContent = `${formatBytes(bytesUploaded)} / ${formatBytes(file.size)}`;
        transferChunks.textContent = totalFiles > 1
          ? `${config.mode} • Item ${queueIndex}/${totalFiles}`
          : (totalChunks === 1 ? '100% Dedicated Bandwidth' : `Dedicated Stream • Chunk ${receivedSet.size}/${totalChunks}`);

        transferStatus.textContent = totalFiles > 1
          ? `Streaming item ${queueIndex}/${totalFiles} (${config.mode})... active`
          : (totalChunks === 1
              ? `Streaming single file at full bandwidth (dedicated pipe)...`
              : `Streaming dedicated pipe (${CONCURRENCY} channel${CONCURRENCY > 1 ? 's' : ''} active)...`);
      }

      if (onProgress) {
        onProgress(bytesUploaded, file.size, percent);
      }
    }

    // Step 3: Populate work queue with missing chunks
    const chunkQueue = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedSet.has(i)) {
        chunkQueue.push(i);
      }
    }

    if (mascotFace) mascotFace.textContent = '{- U -}';

    const CONCURRENCY = Math.min(config.concurrency, Math.max(1, chunkQueue.length));
    let hasFailed = false;

    async function worker() {
      while (chunkQueue.length > 0 && !hasFailed && !isCurrentTransferCancelled) {
        const i = chunkQueue.shift();
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunkLen = end - start;
        const chunkBlob = file.slice(start, end);

        let success = false;
        let retries = 0;

        while (!success && retries < 5 && !hasFailed && !isCurrentTransferCancelled) {
          try {
            inFlightBytes.set(i, 0);
            await uploadChunkViaXHR(
              `/api/upload/chunk/${fileId}/${i}`,
              chunkBlob,
              abortController.signal,
              (loaded) => {
                inFlightBytes.set(i, Math.min(chunkLen, loaded));
                updateProgressUI(false);
              }
            );

            inFlightBytes.delete(i);
            if (!receivedSet.has(i)) {
              receivedSet.add(i);
              completedBytes = Math.min(file.size, completedBytes + chunkLen);
            }
            success = true;
            updateProgressUI(true);
          } catch (err) {
            inFlightBytes.delete(i);
            if (isCurrentTransferCancelled || err.name === 'AbortError' || abortController.signal.aborted) {
              hasFailed = true;
              return;
            }
            retries++;
            if (ownsMainPanel()) {
              transferStatus.textContent = `Retrying chunk ${i + 1} (Attempt ${retries}/5)...`;
            }
            await new Promise(r => setTimeout(r, 400 * retries));
          }
        }

        if (!success) {
          hasFailed = true;
          if (!isCurrentTransferCancelled && ownsMainPanel()) {
            transferStatus.textContent = `Interrupted on chunk ${i + 1}. Auto-resuming...`;
          }
          return;
        }
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    if (hasFailed || isCurrentTransferCancelled) {
      return false;
    }

    // Step 4: Finalize file on host + Mesh routing
    if (ownsMainPanel()) {
      transferStatus.textContent = totalFiles > 1 ? `Finalizing item ${queueIndex} of ${totalFiles}...` : 'Finalizing transfer & routing...';
    }
    try {
      const finalRes = await fetch(`/api/upload/complete/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          fromSlot: mySlot || 'Node',
          toSlot: targetSlot,
          queueIndex,
          totalFiles
        })
      });

      if (finalRes.ok) {
        if (ownsMainPanel()) {
          if (mascotFace) mascotFace.textContent = '{- ^ -}';
          progressBar.style.width = '100%';
          transferSpeed.textContent = 'Done!';
          transferEta.textContent = '0:00';

          if (targetSlot === 'U') {
            transferStatus.textContent = totalFiles > 1 ? `Transferred item ${queueIndex} of ${totalFiles}.` : 'Transferred to Host Downloads/uDrop.';
          } else if (targetSlot === 'ALL') {
            transferStatus.textContent = 'Broadcasted to All Connected Devices.';
          } else {
            transferStatus.textContent = `Beamed to Node [ ${targetSlot} ] via Host Bridge.`;
          }
          transferStatus.style.color = 'var(--status-green)';
        }
        return true;
      } else {
        if (ownsMainPanel()) transferStatus.textContent = 'Error during finalization.';
        return false;
      }
    } catch (err) {
      if (isCurrentTransferCancelled) return false;
      if (ownsMainPanel()) transferStatus.textContent = 'Host failed to finalize file.';
      return false;
    }
  } finally {
    activeUploadSessions.delete(fileId);
  }
}

// 7. Initial Run & Intervals
checkHostConnection();
loadHostFiles();
joinMesh();
connectMeshEvents();

setInterval(checkHostConnection, 6000);
setInterval(loadHostFiles, 8000);

// Keep-alive heartbeat every 6s so inactive tabs timeout promptly without lag
setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  reconcileMeshPresence();
}, 6000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reconcileMeshPresence();
    loadHostFiles();
  }
});

window.addEventListener('focus', () => {
  reconcileMeshPresence();
});

// Notify mesh when tab/browser closes or hides persistently to free slot immediately
function sendMeshLeaveBeacon() {
  if (leaveBeaconSent || !myClientId || isLocalHostPage()) return;
  leaveBeaconSent = true;
  if (navigator.sendBeacon) {
    const payload = new Blob([JSON.stringify({ clientId: myClientId })], { type: 'application/json' });
    navigator.sendBeacon('/api/mesh/leave', payload);
  }
}

window.addEventListener('pagehide', (e) => {
  if (!e || !e.persisted) {
    sendMeshLeaveBeacon();
  }
});
window.addEventListener('beforeunload', sendMeshLeaveBeacon);

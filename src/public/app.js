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

let currentUploadAbortController = null;
let isCurrentTransferCancelled = false;
let currentUploadFileId = null;
const refreshFilesBtn = document.getElementById('refreshFilesBtn');

// UXIOM Mesh DOM Elements
const mySlotBadge = document.getElementById('mySlotBadge');
const meshRing = document.getElementById('meshRing');
const targetNodeText = document.getElementById('targetNodeText');
const dropzoneActionText = document.getElementById('dropzoneActionText');
const incomingTransferCard = document.getElementById('incomingTransferCard');
const incomingFromText = document.getElementById('incomingFromText');
const incomingFileName = document.getElementById('incomingFileName');
const incomingFileSize = document.getElementById('incomingFileSize');
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

// UXIOM Mesh State
let myClientId = localStorage.getItem('udrop_mesh_client_id');
if (!myClientId) {
  myClientId = 'client_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11));
  localStorage.setItem('udrop_mesh_client_id', myClientId);
}

let mySlot = null; // 'X', 'I', 'O', 'M' or 'U'
let targetSlot = 'U'; // Default recipient: Host [ U ]
let currentRingState = [];

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
      hostFilesList.innerHTML = '<p class="empty-state">No files currently shared by the host.</p>';
      return;
    }

    const canUnshare = isLocalHostPage();
    hostFilesList.innerHTML = files.map(f => {
      const safeName = escapeHtml(f.name);
      const safeId = encodeURIComponent(f.id);
      return `
      <div class="file-row">
        <div class="file-row-info">
          <span class="file-row-name" title="${safeName}">${safeName}</span>
          <span class="file-row-size">${formatBytes(f.size)}</span>
        </div>
        <div class="file-row-actions">
          <a href="/api/download/${safeId}" class="btn-download" download>Download</a>
          ${canUnshare ? `<button type="button" class="btn-unshare" data-unshare-id="${safeId}" title="Remove from shared list">&times;</button>` : ''}
        </div>
      </div>
    `;
    }).join('');

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

function renderRing(ring) {
  if (!meshRing) return;
  currentRingState = ring || [];
  meshRing.innerHTML = '';

  ring.forEach(node => {
    const isSelf = (node.slot === mySlot);
    const isTarget = (node.slot === targetSlot);
    const safeNodeName = escapeHtml(node.assigned ? node.name : 'Empty');
    const safeSlot = escapeHtml(node.slot);

    const nodeEl = document.createElement('div');
    nodeEl.className = 'ring-node';
    if (node.assigned) nodeEl.classList.add('ring-node-active');
    if (isSelf) nodeEl.classList.add('ring-node-self');
    if (isTarget) nodeEl.classList.add('ring-node-selected');

    nodeEl.innerHTML = `
      ${isSelf ? '<span class="self-tag">YOU</span>' : ''}
      <span class="ring-node-letter">[ ${safeSlot} ]</span>
      <span class="ring-node-device" title="${safeNodeName}">${safeNodeName}</span>
    `;

    // Only allow selecting valid targets (can't target oneself)
    if (!isSelf && node.assigned) {
      nodeEl.addEventListener('click', () => {
        selectTarget(node.slot, `[ ${node.slot} ] ${node.name}`);
      });
    } else if (!isSelf && !node.assigned && node.slot === 'U') {
      // Host slot fallback
      nodeEl.addEventListener('click', () => {
        selectTarget('U', '[ U ] Master Host');
      });
    }

    meshRing.appendChild(nodeEl);
  });

  // Swarm / Broadcast Node [ ALL ]
  const isSwarmTarget = (targetSlot === 'ALL');
  const swarmEl = document.createElement('div');
  swarmEl.className = 'ring-node ring-node-all ring-node-active' + (isSwarmTarget ? ' ring-node-selected' : '');
  swarmEl.innerHTML = `
    <span class="ring-node-letter ring-node-letter-all">[ ALL ]</span>
    <span class="ring-node-device">Swarm All</span>
  `;
  swarmEl.addEventListener('click', () => {
    selectTarget('ALL', '[ ALL ] All Mesh Devices (Swarm Broadcast)');
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
  const eventSource = new EventSource('/api/mesh/events');

  eventSource.onmessage = (e) => {
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

  eventSource.onerror = () => {
    // Browser auto-reconnects SSE
  };
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
const glassModalPanel = document.getElementById('glassModalPanel');
const glassThemeBtns = document.querySelectorAll('.glass-theme-btn');

let activeModalTheme = 'obsidian';
let kineticModalQr = (glassQrCanvas && typeof window.createKineticQr === 'function')
  ? window.createKineticQr(glassQrCanvas, { theme: activeModalTheme })
  : null;
let isDismantlingModal = false;

function openQrModal() {
  if (!qrGlassModal) return;
  isDismantlingModal = false;
  qrGlassModal.classList.remove('hidden');
  qrGlassModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (kineticModalQr) {
    kineticModalQr.assemble({ theme: activeModalTheme });
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

// Auto-open modal if requested via URL (?pair or ?qr)
if (window.location.search.includes('pair') || window.location.search.includes('qr')) {
  setTimeout(openQrModal, 200);
}

glassThemeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    glassThemeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const theme = btn.dataset.theme;
    activeModalTheme = theme;
    if (kineticModalQr) {
      kineticModalQr.setTheme(theme);
    }
    if (glassModalPanel) {
      glassModalPanel.className = `glass-modal-panel theme-${theme}`;
    }
  });
});

// Auto-open if URL contains ?qr=open or ?qr=1 or hash is #qr
if (window.location.search.includes('qr=') || window.location.hash === '#qr') {
  openQrModal();
}

function handleIncomingMeshTransfer(transfer) {
  // If sent by this device, ignore
  if (transfer.fromSlot === mySlot) return;

  // If targeted specifically to someone else, ignore
  if (transfer.toSlot !== 'ALL' && transfer.toSlot !== mySlot) return;

  if (incomingTransferCard) {
    incomingFromText.textContent = `From Node [ ${transfer.fromSlot} ] -> [ ${transfer.toSlot} ]`;
    incomingFileName.textContent = transfer.fileName;
    incomingFileSize.textContent = formatBytes(transfer.fileSize);
    incomingDownloadBtn.href = transfer.downloadUrl;
    incomingDownloadBtn.setAttribute('download', transfer.fileName);
    incomingTransferCard.classList.remove('hidden');

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }
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
      ctx.fillStyle = '#000000';
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

// Bandwidth Smartness & Dynamic Allocation
// Single-file mode: Allocates 100% of pipeline bandwidth to the single file (0 channel contention, direct full-speed stream)
// Multi-file batch mode: Uses balanced 4MB chunks for responsive queue progression and individual resilience
function getOptimalChunkConfig(fileSize, totalFiles = 1) {
  if (totalFiles === 1) {
    // Single file dedicated bandwidth allocation:
    if (fileSize <= 64 * 1024 * 1024) {
      // Files <= 64MB (e.g. 40MB video): 1 single continuous full-speed burst chunk!
      return {
        chunkSize: Math.max(1, fileSize),
        concurrency: 1,
        mode: 'Dedicated Full-Bandwidth Turbo Pipe'
      };
    }
    if (fileSize <= 256 * 1024 * 1024) {
      // 64MB - 256MB: 32MB chunks for maximum socket throughput without fragmentation
      return {
        chunkSize: 32 * 1024 * 1024,
        concurrency: 1,
        mode: 'High-Bandwidth Dedicated Pipe'
      };
    }
    // Very large 4K single videos (> 256MB): 16MB chunks with dual-pipeline saturation
    return {
      chunkSize: 16 * 1024 * 1024,
      concurrency: 2,
      mode: 'Dual High-Speed Pipeline'
    };
  }

  // Multi-File Batch Mode (totalFiles > 1):
  if (fileSize > 350 * 1024 * 1024) {
    return {
      chunkSize: 8 * 1024 * 1024,
      concurrency: 2,
      mode: 'Multi-Item Batch Pipeline'
    };
  }
  return {
    chunkSize: 4 * 1024 * 1024,
    concurrency: 2,
    mode: 'Multi-Item Batch Pipeline'
  };
}

function getOptimalChunkSize(fileSize, totalFiles = 1) {
  return getOptimalChunkConfig(fileSize, totalFiles).chunkSize;
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
    const fileIdToCancel = currentUploadFileId;

    if (currentUploadAbortController) {
      try {
        currentUploadAbortController.abort();
      } catch (e) {}
    }

    currentUploadAbortController = null;
    currentUploadFileId = null;

    // Immediately purge queue and state so re-transfers start completely fresh
    activeBatchQueue = [];
    if (queueItemsList) queueItemsList.innerHTML = '';
    if (batchSummaryBar) batchSummaryBar.classList.add('hidden');
    if (queueListWrapper) queueListWrapper.classList.add('hidden');
    if (fileInput) { fileInput.value = ''; fileInput.disabled = false; }
    if (mediaInput) { mediaInput.value = ''; mediaInput.disabled = false; }
    releaseScreenWakeLock();

    transferStatus.textContent = 'Transfer cancelled.';
    transferStatus.style.color = '#F87171';
    transferSpeed.textContent = 'Cancelled';
    transferEta.textContent = '--:--';
    cancelTransferBtn.style.display = 'none';

    if (fileIdToCancel) {
      try {
        await fetch(`/api/upload/cancel/${fileIdToCancel}`, { method: 'POST' });
      } catch (e) {}
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

async function processBatchQueue() {
  renderQueueList();
  transferContainer.classList.remove('hidden');

  const totalFiles = activeBatchQueue.length;
  if (totalFiles > 1) {
    if (batchSummaryBar) batchSummaryBar.classList.remove('hidden');
    if (queueListWrapper) queueListWrapper.classList.remove('hidden');
  }

  updateBatchProgress();

  let successCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < activeBatchQueue.length; idx++) {
    if (isCurrentTransferCancelled) break;
    const item = activeBatchQueue[idx];
    if (item.status === 'done') {
      successCount++;
      continue;
    }

    item.status = 'uploading';
    renderQueueList();

    // Auto-scroll active item into view
    const pill = document.getElementById(`queuePill_${item.id}`);
    if (pill && pill.parentElement) {
      pill.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Try uploading with up to 2 file-level retries
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok && !isCurrentTransferCancelled; attempt++) {
      if (attempt > 1) {
        transferStatus.textContent = `Retrying item ${idx + 1} of ${totalFiles} (Attempt ${attempt}/2)... transfer will resume.`;
        await new Promise(r => setTimeout(r, 1200));
      }

      ok = await uploadFileChunked(item.file, idx + 1, totalFiles, (bytes, size, pct) => {
        item.uploadedBytes = bytes;
        item.progress = pct;
        updateBatchProgress();
        const activePill = document.getElementById(`queuePill_${item.id}`);
        if (activePill) activePill.textContent = `${pct}%`;
      });
    }

    if (isCurrentTransferCancelled) break;

    if (ok) {
      item.status = 'done';
      item.progress = 100;
      item.uploadedBytes = item.size;
      successCount++;
    } else {
      item.status = 'failed';
      failedCount++;
    }

    renderQueueList();
    updateBatchProgress();

    // Micro-pause (120ms) to allow mobile garbage collection to sweep memory
    await new Promise(r => setTimeout(r, 120));
  }

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
      transferStatus.style.color = '#F87171';
      if (retryFailedBtn) {
        retryFailedBtn.classList.remove('hidden');
        const text = document.getElementById('retryFailedBtnText');
        if (text) text.textContent = `Retry ${failedCount} Failed`;
      }
    } else {
      transferStatus.textContent = `All ${totalFiles} file${totalFiles > 1 ? 's' : ''} transferred successfully.`;
      transferStatus.style.color = '#22C55E';
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
async function uploadFileChunked(file, queueIndex = 1, totalFiles = 1, onProgress = null) {
  if (isCurrentTransferCancelled) return false;

  const config = getOptimalChunkConfig(file.size, totalFiles);
  const chunkSize = config.chunkSize;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const randTag = Math.random().toString(36).substring(2, 7);
  const cleanBase = (file.name || 'video.mp4').replace(/[^a-zA-Z0-9._\- ()]/g, '_');
  const fileId = `${cleanBase}_${file.size}_${file.lastModified || Date.now()}_${randTag}`.replace(/[^a-zA-Z0-9_]/g, '_');

  currentUploadAbortController = new AbortController();
  currentUploadFileId = fileId;

  transferContainer.classList.remove('hidden');
  if (cancelTransferBtn) cancelTransferBtn.style.display = '';
  transferFileName.textContent = totalFiles > 1 ? `[${queueIndex}/${totalFiles}] ${file.name || cleanBase}` : (file.name || cleanBase);
  transferStats.textContent = `0 B / ${formatBytes(file.size)}`;
  transferSpeed.textContent = 'Connecting...';
  transferEta.textContent = '--:--';
  progressBar.style.width = '0%';
  transferChunks.textContent = totalFiles > 1 
    ? `Queue ${queueIndex}/${totalFiles} • Chunk 0/${totalChunks}` 
    : (totalChunks === 1 ? 'Dedicated 100% Bandwidth Pipe' : `Dedicated Stream • Chunk 0/${totalChunks}`);

  transferStatus.textContent = totalFiles > 1 
    ? `Preparing item ${queueIndex} of ${totalFiles}...` 
    : (totalChunks === 1 ? 'Allocating 100% bandwidth to single file...' : 'Initializing dedicated stream...');

  // Step 1: Initialize sparse session on host with 25s timeout
  let initRes;
  try {
    const initCtrl = new AbortController();
    const initTimer = setTimeout(() => initCtrl.abort(), 25000);
    const combinedSignal = combineSignals(currentUploadAbortController.signal, initCtrl.signal);

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
    transferStatus.textContent = 'Failed to initialize session.';
    return false;
  }

  // Step 2: Check existing status (auto-resume)
  let receivedSet = new Set();
  try {
    const statusRes = await fetch(`/api/upload/status/${fileId}`, {
      signal: currentUploadAbortController.signal
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

    const percent = file.size > 0 ? Math.min(100, Math.round((bytesUploaded / file.size) * 100)) : 100;
    progressBar.style.width = `${percent}%`;
    transferStats.textContent = `${formatBytes(bytesUploaded)} / ${formatBytes(file.size)}`;
    transferChunks.textContent = totalFiles > 1
      ? `Queue ${queueIndex}/${totalFiles} • Chunk ${receivedSet.size}/${totalChunks}`
      : (totalChunks === 1 ? '100% Dedicated Bandwidth' : `Dedicated Stream • Chunk ${receivedSet.size}/${totalChunks}`);

    transferStatus.textContent = totalFiles > 1
      ? `Streaming item ${queueIndex}/${totalFiles} (${formatBytes(chunkSize)} chunks)... active`
      : (totalChunks === 1
          ? `Streaming single file at full bandwidth (dedicated pipe)...`
          : `Streaming dedicated pipe (${CONCURRENCY} channel${CONCURRENCY > 1 ? 's' : ''} active)...`);

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
            currentUploadAbortController ? currentUploadAbortController.signal : undefined,
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
          if (isCurrentTransferCancelled || err.name === 'AbortError' || currentUploadAbortController?.signal?.aborted) {
            hasFailed = true;
            return;
          }
          retries++;
          transferStatus.textContent = `Retrying chunk ${i + 1} (Attempt ${retries}/5)...`;
          await new Promise(r => setTimeout(r, 400 * retries));
        }
      }

      if (!success) {
        hasFailed = true;
        if (!isCurrentTransferCancelled) {
          transferStatus.textContent = `Interrupted on chunk ${i + 1}. Auto-resuming...`;
        }
        return;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  if (hasFailed || isCurrentTransferCancelled) {
    currentUploadAbortController = null;
    currentUploadFileId = null;
    return false;
  }

  // Step 4: Finalize file on host + Mesh routing
  transferStatus.textContent = totalFiles > 1 ? `Finalizing item ${queueIndex} of ${totalFiles}...` : 'Finalizing transfer & routing...';
  try {
    const finalRes = await fetch(`/api/upload/complete/${fileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: currentUploadAbortController ? currentUploadAbortController.signal : undefined,
      body: JSON.stringify({
        fromSlot: mySlot || 'Node',
        toSlot: targetSlot,
        queueIndex,
        totalFiles
      })
    });

    if (finalRes.ok) {
      if (mascotFace) mascotFace.textContent = '{- ^ -}';
      progressBar.style.width = '100%';
      transferSpeed.textContent = 'Done!';
      transferEta.textContent = '0:00';

      if (targetSlot === 'U') {
        transferStatus.textContent = totalFiles > 1 ? `Transferred item ${queueIndex} of ${totalFiles}.` : 'Transferred to Host Downloads/uDrop.';
      } else if (targetSlot === 'ALL') {
        transferStatus.textContent = 'Broadcasted to All Devices in UXIOM Mesh.';
      } else {
        transferStatus.textContent = `Beamed to Node [ ${targetSlot} ] via Host Bridge.`;
      }
      transferStatus.style.color = '#22C55E';

      currentUploadAbortController = null;
      currentUploadFileId = null;
      return true;
    } else {
      transferStatus.textContent = 'Error during finalization.';
      currentUploadAbortController = null;
      currentUploadFileId = null;
      return false;
    }
  } catch (err) {
    if (isCurrentTransferCancelled) return false;
    transferStatus.textContent = 'Host failed to finalize file.';
    currentUploadAbortController = null;
    currentUploadFileId = null;
    return false;
  }
}

// 7. Initial Run & Intervals
checkHostConnection();
loadHostFiles();
joinMesh();
connectMeshEvents();

setInterval(checkHostConnection, 6000);
setInterval(loadHostFiles, 8000);

// Keep-alive heartbeat every 15s
setInterval(async () => {
  if (myClientId) {
    try {
      await fetch('/api/mesh/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: myClientId })
      });
    } catch (e) {}
  }
}, 15000);

// Notify mesh when tab/browser closes to free slot immediately
window.addEventListener('beforeunload', () => {
  if (myClientId && navigator.sendBeacon) {
    const payload = new Blob([JSON.stringify({ clientId: myClientId })], { type: 'application/json' });
    navigator.sendBeacon('/api/mesh/leave', payload);
  }
});

import os from 'node:os';
import { getFileContextMeta } from './file-context.js';

const SLOTS = ['U', 'X', 'I', 'O', 'M'];
const MESH_NODES = new Map();
const SSE_CLIENTS = new Set();
const LOCAL_SSE_CLIENTS = new Set();
const CLIENT_SSE_SOCKETS = new Map();
const PENDING_DISCONNECTS = new Map();
const DISCONNECT_GRACE_MS = 1800;

// Initialize Host Node [ U ]
function initHostNode() {
  MESH_NODES.set('U', {
    slot: 'U',
    clientId: 'host_master',
    name: `${os.hostname()} (Host)`,
    platform: os.platform(),
    isHost: true,
    lastSeen: Date.now()
  });
}
initHostNode();

/**
 * Normalizes user-agent string to friendly device label (iPhone, Android, Mac, etc.)
 */
function parseDeviceName(userAgent = '') {
  if (/iPhone/i.test(userAgent)) return 'iPhone (Safari)';
  if (/iPad/i.test(userAgent)) return 'iPad (Safari)';
  if (/Android/i.test(userAgent)) return 'Android (Chrome)';
  if (/Macintosh/i.test(userAgent)) return 'MacBook';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux Device';
  return 'Mobile Device';
}

function clearPendingDisconnect(clientId) {
  if (!clientId) return;
  const timer = PENDING_DISCONNECTS.get(clientId);
  if (timer) {
    clearTimeout(timer);
    PENDING_DISCONNECTS.delete(clientId);
  }
}

function schedulePendingDisconnect(clientId, graceMs = DISCONNECT_GRACE_MS) {
  if (!clientId || clientId === 'host_master') return;
  clearPendingDisconnect(clientId);
  const timer = setTimeout(() => {
    PENDING_DISCONNECTS.delete(clientId);
    const sockets = CLIENT_SSE_SOCKETS.get(clientId);
    if (!sockets || sockets.size === 0) {
      unregisterMeshNode(clientId);
    }
  }, graceMs);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  PENDING_DISCONNECTS.set(clientId, timer);
}

/**
 * Removes expired non-host nodes whose heartbeat lease timed out.
 */
export function pruneStaleNodes(timeoutMs = 18000) {
  const now = Date.now();
  let changed = false;
  for (const [slot, node] of MESH_NODES.entries()) {
    if (!node.isHost && (now - node.lastSeen > timeoutMs)) {
      clearPendingDisconnect(node.clientId);
      MESH_NODES.delete(slot);
      changed = true;
    }
  }
  if (changed) broadcastRingUpdate();
  return changed;
}

const staleSweepTimer = setInterval(() => {
  pruneStaleNodes();
  for (const res of SSE_CLIENTS) {
    try {
      res.write(': ping\n\n');
    } catch {
      SSE_CLIENTS.delete(res);
      LOCAL_SSE_CLIENTS.delete(res);
    }
  }
}, 5000);
if (staleSweepTimer && typeof staleSweepTimer.unref === 'function') {
  staleSweepTimer.unref();
}

/**
 * Registers an incoming device into the next available UXIOM slot.
 * Loopback host sessions attach to [ U ] without consuming a mobile slot.
 */
export function registerMeshNode(clientId, userAgent = '', { isLocalHost = false } = {}) {
  clearPendingDisconnect(clientId);
  pruneStaleNodes();

  if (isLocalHost) {
    const hostNode = MESH_NODES.get('U');
    if (hostNode) hostNode.lastSeen = Date.now();
    return {
      slot: 'U',
      node: hostNode,
      ring: getMeshRing()
    };
  }

  // Check if client already holds a slot
  for (const [slot, node] of MESH_NODES.entries()) {
    if (node.clientId === clientId) {
      node.lastSeen = Date.now();
      return { slot, node, ring: getMeshRing() };
    }
  }

  // Find first available slot among X, I, O, M
  const availableSlot = ['X', 'I', 'O', 'M'].find(s => !MESH_NODES.has(s));
  if (!availableSlot) {
    throw new Error('UXIOM Ring is currently full (maximum 5 nodes active).');
  }

  const friendlyName = parseDeviceName(userAgent);
  const newNode = {
    slot: availableSlot,
    clientId,
    name: friendlyName,
    platform: userAgent.includes('iPhone') ? 'ios' : userAgent.includes('Android') ? 'android' : 'other',
    isHost: false,
    lastSeen: Date.now()
  };

  MESH_NODES.set(availableSlot, newNode);
  broadcastRingUpdate();

  return {
    slot: availableSlot,
    node: newNode,
    ring: getMeshRing()
  };
}

/**
 * Unregisters a client from the mesh ring.
 */
export function unregisterMeshNode(clientId) {
  clearPendingDisconnect(clientId);
  for (const [slot, node] of MESH_NODES.entries()) {
    if (node.clientId === clientId && slot !== 'U') {
      MESH_NODES.delete(slot);
      broadcastRingUpdate();
      return true;
    }
  }
  return false;
}

/**
 * Updates node heartbeat and prunes stale nodes.
 */
export function updateHeartbeat(clientId) {
  clearPendingDisconnect(clientId);
  for (const [slot, node] of MESH_NODES.entries()) {
    if (node.clientId === clientId) {
      node.lastSeen = Date.now();
      break;
    }
  }

  pruneStaleNodes();
}

/**
 * Returns current state of all 5 nodes in the UXIOM ring topology.
 */
export function getMeshRing() {
  return SLOTS.map(slot => {
    const node = MESH_NODES.get(slot);
    if (node) {
      return {
        slot,
        assigned: true,
        name: node.name,
        platform: node.platform,
        isHost: node.isHost,
        clientId: node.clientId
      };
    }
    return {
      slot,
      assigned: false,
      name: `Empty [${slot}]`,
      platform: 'none',
      isHost: false
    };
  });
}

function sendSseToAll(eventObj) {
  const payload = JSON.stringify(eventObj);
  for (const res of SSE_CLIENTS) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      SSE_CLIENTS.delete(res);
      LOCAL_SSE_CLIENTS.delete(res);
    }
  }
}

/**
 * Registers an active Server-Sent Events (SSE) response channel.
 * Tracks per-clientId SSE connections so dropped tabs/devices clear promptly.
 */
export function addSSEClient(res, req = null, clientId = null) {
  SSE_CLIENTS.add(res);

  const remoteIp = req?.socket?.remoteAddress || '';
  const isLocal = /127\.0\.0\.1|::1|localhost/i.test(remoteIp);
  if (isLocal) {
    LOCAL_SSE_CLIENTS.add(res);
  }

  let resolvedClientId = clientId;
  if (!resolvedClientId && req?.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      resolvedClientId = parsed.searchParams.get('clientId');
    } catch {}
  }

  if (resolvedClientId) {
    clearPendingDisconnect(resolvedClientId);
    let sockets = CLIENT_SSE_SOCKETS.get(resolvedClientId);
    if (!sockets) {
      sockets = new Set();
      CLIENT_SSE_SOCKETS.set(resolvedClientId, sockets);
    }
    sockets.add(res);
  }

  // Send initial state immediately
  res.write(`data: ${JSON.stringify({ type: 'ring_update', ring: getMeshRing() })}\n\n`);

  res.on('close', () => {
    SSE_CLIENTS.delete(res);
    LOCAL_SSE_CLIENTS.delete(res);
    if (resolvedClientId) {
      const sockets = CLIENT_SSE_SOCKETS.get(resolvedClientId);
      if (sockets) {
        sockets.delete(res);
        if (sockets.size === 0) {
          CLIENT_SSE_SOCKETS.delete(resolvedClientId);
          schedulePendingDisconnect(resolvedClientId);
        }
      }
    }
  });
}

/**
 * Checks if a local desktop viewer or browser tab is actively viewing the host.
 */
export function hasActiveLocalViewer() {
  return LOCAL_SSE_CLIENTS.size > 0;
}

/**
 * Broadcasts ring updates to all connected devices.
 */
export function broadcastRingUpdate() {
  sendSseToAll({ type: 'ring_update', ring: getMeshRing() });
}

/**
 * Broadcasts live host receiving progress and completion across the SSE mesh fabric.
 * Powers the Liquid Glass Dynamic Island on desktop and connected devices.
 */
export function broadcastHostTransferEvent(event) {
  sendSseToAll(event);
}

/**
 * Dispatches an inter-node file transfer alert across the mesh.
 * e.g. Phone [O] (iPhone) sends 4K video to Phone [X] (Android) via Host [U].
 */
export function dispatchMeshTransfer({ fromSlot, toSlot, fileName, fileSize, downloadUrl }) {
  const ctx = getFileContextMeta(fileName);
  sendSseToAll({
    type: 'incoming_mesh_transfer',
    transfer: {
      fromSlot,
      toSlot,
      fileName,
      fileSize,
      downloadUrl,
      category: ctx.category,
      badge: ctx.badge,
      mime: ctx.mime,
      inlineSafe: ctx.inlineSafe,
      timestamp: Date.now()
    }
  });
}



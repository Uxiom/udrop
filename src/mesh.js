import os from 'node:os';

const SLOTS = ['U', 'X', 'I', 'O', 'M'];
const MESH_NODES = new Map();
const SSE_CLIENTS = new Set();
const LOCAL_SSE_CLIENTS = new Set();

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

/**
 * Removes expired non-host nodes whose heartbeat lease timed out.
 */
export function pruneStaleNodes(timeoutMs = 35000) {
  const now = Date.now();
  let changed = false;
  for (const [slot, node] of MESH_NODES.entries()) {
    if (!node.isHost && (now - node.lastSeen > timeoutMs)) {
      MESH_NODES.delete(slot);
      changed = true;
    }
  }
  if (changed) broadcastRingUpdate();
  return changed;
}

const staleSweepTimer = setInterval(() => pruneStaleNodes(), 15000);
if (staleSweepTimer && typeof staleSweepTimer.unref === 'function') {
  staleSweepTimer.unref();
}

/**
 * Registers an incoming device into the next available UXIOM slot.
 * Loopback host sessions attach to [ U ] without consuming a mobile slot.
 */
export function registerMeshNode(clientId, userAgent = '', { isLocalHost = false } = {}) {
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
 * Updates node heartbeat and prunes stale nodes (inactive for > 35 seconds).
 */
export function updateHeartbeat(clientId) {
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

/**
 * Registers an active Server-Sent Events (SSE) response channel.
 */
export function addSSEClient(res, req = null) {
  SSE_CLIENTS.add(res);

  const remoteIp = req?.socket?.remoteAddress || '';
  const isLocal = /127\.0\.0\.1|::1|localhost/i.test(remoteIp);
  if (isLocal) {
    LOCAL_SSE_CLIENTS.add(res);
  }

  // Send initial state immediately
  res.write(`data: ${JSON.stringify({ type: 'ring_update', ring: getMeshRing() })}\n\n`);

  res.on('close', () => {
    SSE_CLIENTS.delete(res);
    LOCAL_SSE_CLIENTS.delete(res);
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
  const payload = JSON.stringify({ type: 'ring_update', ring: getMeshRing() });
  for (const res of SSE_CLIENTS) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      SSE_CLIENTS.delete(res);
    }
  }
}

/**
 * Broadcasts live host receiving progress and completion across the SSE mesh fabric.
 * Powers the Liquid Glass Dynamic Island on desktop and connected devices.
 */
export function broadcastHostTransferEvent(event) {
  const payload = JSON.stringify(event);
  for (const res of SSE_CLIENTS) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      SSE_CLIENTS.delete(res);
    }
  }
}


/**
 * Dispatches an inter-node file transfer alert across the mesh.
 * e.g. Phone [O] (iPhone) sends 4K video to Phone [X] (Android) via Host [U].
 */
export function dispatchMeshTransfer({ fromSlot, toSlot, fileName, fileSize, downloadUrl }) {
  const payload = JSON.stringify({
    type: 'incoming_mesh_transfer',
    transfer: {
      fromSlot,
      toSlot,
      fileName,
      fileSize,
      downloadUrl,
      timestamp: Date.now()
    }
  });

  for (const res of SSE_CLIENTS) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      SSE_CLIENTS.delete(res);
    }
  }
}



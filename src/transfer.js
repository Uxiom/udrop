import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESSIONS = new Map();
const OUTBOUND_FILES = new Map();
let outboundSeq = 0;

/**
 * Gets or creates the default uDrop download folder in the user's Downloads directory.
 */
export function getDownloadDirectory() {
  const homeDir = os.homedir();
  const downloadDir = path.join(homeDir, 'Downloads', 'uDrop');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  return downloadDir;
}

/**
 * Initializes a new chunked upload session using direct-to-disk sparse writes.
 */
export async function initUploadSession({ fileId, fileName, fileSize, totalChunks, chunkSize }) {
  let session = SESSIONS.get(fileId);
  if (session && !session.isComplete) {
    session.lastActivityAt = Date.now();
    return session;
  }

  const parsedSize = Number(fileSize);
  const parsedChunks = Number(totalChunks);
  const parsedChunkSize = Number(chunkSize);
  if (!Number.isFinite(parsedSize) || parsedSize < 0) {
    throw new Error('Invalid fileSize');
  }
  if (!Number.isInteger(parsedChunks) || parsedChunks < 1) {
    throw new Error('Invalid totalChunks');
  }
  if (!Number.isFinite(parsedChunkSize) || parsedChunkSize < 1) {
    throw new Error('Invalid chunkSize');
  }

  const cleanName = path.basename(fileName || 'upload.bin').replace(/[^a-zA-Z0-9._\- ()]/g, '_');
  const downloadDir = getDownloadDirectory();
  let targetPath = path.join(downloadDir, cleanName);

  // Avoid overwriting existing files
  if (fs.existsSync(targetPath)) {
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);
    targetPath = path.join(downloadDir, `${base}_${Date.now()}${ext}`);
  }

  // Open single file handle with read/write access (w+)
  const fileHandle = await fs.promises.open(targetPath, 'w+');

  session = {
    fileId,
    fileName: cleanName,
    filePath: targetPath,
    fileHandle,
    fileSize: parsedSize,
    totalChunks: parsedChunks,
    chunkSize: parsedChunkSize,
    receivedChunks: new Set(),
    receivedBytes: 0,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    isComplete: false
  };

  SESSIONS.set(fileId, session);
  return session;
}

/**
 * Retrieves the current status of an upload session (for auto-resume).
 */
export function getUploadStatus(fileId) {
  const session = SESSIONS.get(fileId);
  if (!session) return null;
  return {
    fileId: session.fileId,
    fileName: session.fileName,
    fileSize: session.fileSize,
    chunkSize: session.chunkSize,
    totalChunks: session.totalChunks,
    receivedChunks: Array.from(session.receivedChunks),
    receivedBytes: session.receivedBytes || 0,
    isComplete: session.isComplete
  };
}

/**
 * Writes a received chunk directly into its calculated offset in the target file.
 * Zero temporary files, zero duplicate I/O, supports out-of-order parallel arrivals.
 */
export async function writeChunk(fileId, chunkIndex, buffer) {
  const session = SESSIONS.get(fileId);
  if (!session) {
    throw new Error(`Upload session '${fileId}' not found.`);
  }

  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    throw new Error(`Invalid chunk index ${chunkIndex} for totalChunks=${session.totalChunks}`);
  }

  session.lastActivityAt = Date.now();
  const offset = index * session.chunkSize;

  // Direct offset write onto SSD
  await session.fileHandle.write(buffer, 0, buffer.length, offset);
  const isNewChunk = !session.receivedChunks.has(index);
  session.receivedChunks.add(index);
  if (isNewChunk) {
    session.receivedBytes = Math.min(session.fileSize, (session.receivedBytes || 0) + buffer.length);
  }

  return {
    chunkIndex: index,
    receivedTotal: session.receivedChunks.size,
    totalChunks: session.totalChunks,
    receivedBytes: session.receivedBytes
  };
}

/**
 * Closes open handles for abandoned sessions idle longer than maxIdleMs.
 */
export async function reapStaleSessions(maxIdleMs = 60 * 60 * 1000) {
  const now = Date.now();
  for (const [id, session] of SESSIONS.entries()) {
    if (!session.isComplete && (now - (session.lastActivityAt || session.createdAt) > maxIdleMs)) {
      await cancelUploadSession(id);
    }
  }
}

/**
 * Closes all in-progress session file handles cleanly during server shutdown.
 */
export async function closeAllSessions() {
  for (const [id] of Array.from(SESSIONS.entries())) {
    await cancelUploadSession(id);
  }
}

const sessionReaper = setInterval(() => {
  reapStaleSessions().catch(() => {});
}, 10 * 60 * 1000);
if (sessionReaper && typeof sessionReaper.unref === 'function') {
  sessionReaper.unref();
}

/**
 * Finalizes the file: closes the file handle immediately.
 * Assembly time is 0.00 seconds because chunks were already written directly into place!
 */
export async function finalizeUpload(fileId) {
  const session = SESSIONS.get(fileId);
  if (!session) {
    throw new Error(`Upload session '${fileId}' not found.`);
  }

  if (session.receivedChunks.size < session.totalChunks) {
    throw new Error(`Incomplete upload: received ${session.receivedChunks.size} of ${session.totalChunks} chunks.`);
  }

  try {
    await session.fileHandle.truncate(session.fileSize);
    await session.fileHandle.close();
  } catch (err) {
    // Handle already closed or truncated
  }

  session.isComplete = true;
  SESSIONS.delete(fileId);

  return {
    fileId,
    fileName: session.fileName,
    filePath: session.filePath,
    fileSize: session.fileSize
  };
}

/**
 * Cancels an in-progress upload session: closes file handle, unlinks partial file from disk,
 * and cleans up session state.
 */
export async function cancelUploadSession(fileId) {
  const session = SESSIONS.get(fileId);
  if (!session) return { success: true, notFound: true };

  try {
    if (session.fileHandle) {
      await session.fileHandle.close();
    }
  } catch (e) {}

  try {
    if (session.filePath && fs.existsSync(session.filePath)) {
      await fs.promises.unlink(session.filePath);
    }
  } catch (e) {}

  SESSIONS.delete(fileId);
  return { success: true, cancelled: true };
}

/**
 * Registers a file from the host PC to be downloadable by connected devices.
 */
export function registerOutboundFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Cannot share a directory directly: ${resolved}`);
  }

  outboundSeq = (outboundSeq + 1) % 100000;
  const id = Buffer.from(path.basename(resolved)).toString('hex').slice(0, 8) + '_' + Date.now().toString(36) + '_' + outboundSeq;
  const info = {
    id,
    name: path.basename(resolved),
    size: stat.size,
    path: resolved
  };

  OUTBOUND_FILES.set(id, info);
  return info;
}

/**
 * Unregisters an outbound file by its ID.
 */
export function unregisterOutboundFile(id) {
  return OUTBOUND_FILES.delete(id);
}

/**
 * Lists all files currently shared by the PC.
 */
export function getOutboundFiles() {
  return Array.from(OUTBOUND_FILES.values()).map(f => ({
    id: f.id,
    name: f.name,
    size: f.size
  }));
}

/**
 * Gets the absolute path of an outbound file by its ID.
 */
export function getOutboundFile(id) {
  return OUTBOUND_FILES.get(id);
}

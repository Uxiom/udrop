import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import QRCode from 'qrcode';
import {
  initUploadSession,
  getUploadStatus,
  writeChunk,
  finalizeUpload,
  cancelUploadSession,
  getOutboundFiles,
  getOutboundFile,
  registerOutboundFile,
  unregisterOutboundFile,
  closeAllSessions,
  getDownloadDirectory
} from './transfer.js';
import {
  registerMeshNode,
  unregisterMeshNode,
  getMeshRing,
  addSSEClient,
  updateHeartbeat,
  dispatchMeshTransfer,
  broadcastHostTransferEvent,
  hasActiveLocalViewer
} from './mesh.js';
import { generateSleekQrSvg } from './qr-svg.js';
import { getLocalIpAddresses, getLocalHostInfo } from './network.js';
import { launchDesktopOverlay } from './desktop.js';
import { EMBEDDED_ASSETS } from './embedded-assets.js';

const _filename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : process.argv[1]);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);
const PUBLIC_DIR = path.join(_dirname, 'public');

/**
 * Verifies the incoming socket originates from local loopback interface only.
 */
function isLoopbackRequest(req) {
  const ip = req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Creates and starts the uDrop native HTTP engine.
 */
export function startServer({ port = 4040, host = '0.0.0.0', onUploadComplete, onShutdown } = {}) {
  const lastBroadcastMap = new Map();
  const inFlightSessionBytes = new Map();
  const activeTransfers = new Map();
  const recentCompleted = [];
  let lastQrScanAt = 0;

  function pushRecentCompleted(entry) {
    recentCompleted.unshift(entry);
    if (recentCompleted.length > 12) {
      recentCompleted.length = 12;
    }
  }

  const server = http.createServer(async (req, res) => {
    // Enable CORS for local cross-origin if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
      // API: Host info
      if (req.method === 'GET' && pathname === '/api/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          hostname: os.hostname(),
          platform: os.platform(),
          port
        }));
        return;
      }

      // API: Sleek Vector QR SVG Card (Dynamic Generation with Privacy-First Masking)
      if (req.method === 'GET' && pathname === '/api/qr.svg') {
        const hostInfo = getLocalHostInfo(port);
        const mode = parsedUrl.searchParams.get('mode');
        // By default encode mDNS hostname so IP is never exposed. Supports ?mode=ip if needed.
        const connectUrl = (mode === 'ip') ? hostInfo.ipUrl : hostInfo.mdnsUrl;
        const theme = parsedUrl.searchParams.get('theme') || 'obsidian';
        const themes = {
          obsidian: { bg: '#09090B', fg: '#FAFAFA' },
          titanium: { bg: '#27272A', fg: '#FAFAFA' },
          paper: { bg: '#FAFAFA', fg: '#09090B' },
          // Aliases & legacy test compatibility
          space: { bg: '#09090B', fg: '#FAFAFA' },
          dark: { bg: '#09090B', fg: '#FAFAFA' },
          black: { bg: '#09090B', fg: '#FAFAFA' },
          silver: { bg: '#27272A', fg: '#FAFAFA' },
          white: { bg: '#FAFAFA', fg: '#09090B' },
          blue: { bg: '#27272A', fg: '#FAFAFA' },
          orange: { bg: '#FF4600', fg: '#000000' },
          yellow: { bg: '#FFE600', fg: '#000000' }
        };
        const selected = themes[theme] || themes.obsidian;
        const accentColor = selected.bg;
        const darkColor = selected.fg;
        const svg = generateSleekQrSvg(connectUrl, {
          accentColor,
          darkColor,
          brandText: 'uDrop',
          subText: 'ZERO-ROUTER 4K P2P',
          displayLabel: hostInfo.maskedLabel
        });
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=UTF-8',
          'Cache-Control': 'no-cache'
        });
        res.end(svg);
        return;
      }

      // API: Raw QR Matrix & Host Connection Metadata (consumed by native Windows Glass Overlay)
      if (req.method === 'GET' && pathname === '/api/qr.matrix') {
        const hostInfo = getLocalHostInfo(port);
        const mode = parsedUrl.searchParams.get('mode');
        const connectUrl = (mode === 'ip') ? hostInfo.ipUrl : hostInfo.mdnsUrl;
        const qr = QRCode.create(connectUrl, { errorCorrectionLevel: 'H' });
        const size = qr.modules.size;
        const rows = [];
        for (let r = 0; r < size; r++) {
          let rowStr = '';
          for (let c = 0; c < size; c++) {
            rowStr += qr.modules.get(r, c) ? '1' : '0';
          }
          rows.push(rowStr);
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify({
          size,
          rows,
          connectUrl,
          mdnsUrl: hostInfo.mdnsUrl,
          ipUrl: hostInfo.ipUrl,
          maskedLabel: hostInfo.maskedLabel,
          hostname: hostInfo.hostname,
          primaryIp: hostInfo.primaryIp,
          port: hostInfo.port
        }));
        return;
      }

      // Page: Sleek QR Showcase Viewer
      if (req.method === 'GET' && pathname === '/qr') {
        const qrHtmlPath = path.join(PUBLIC_DIR, 'qr.html');
        if (fs.existsSync(qrHtmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          fs.createReadStream(qrHtmlPath).pipe(res);
          return;
        } else if (EMBEDDED_ASSETS && EMBEDDED_ASSETS['qr.html']) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(EMBEDDED_ASSETS['qr.html']);
          return;
        }
      }

      // Page: Dedicated Floating Dynamic Island Overlay Mode
      if (req.method === 'GET' && pathname === '/island') {
        const islandHtmlPath = path.join(PUBLIC_DIR, 'island.html');
        if (fs.existsSync(islandHtmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          fs.createReadStream(islandHtmlPath).pipe(res);
          return;
        } else if (EMBEDDED_ASSETS && EMBEDDED_ASSETS['island.html']) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(EMBEDDED_ASSETS['island.html']);
          return;
        }
      }

      // API: Broadcast trigger to pop up Liquid Glass QR Overlay on laptop screen
      if (req.method === 'POST' && pathname === '/api/qr/popup') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        broadcastHostTransferEvent({ type: 'open_qr_modal' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, triggered: true }));
        return;
      }

      // Helper: Launch Windows Explorer or OS file manager cleanly without inheriting Node pipes
      const openInExplorer = (target, isSelect = false) => {
        if (process.env.CI === 'true' || process.env.UDROP_NO_GUI === '1') {
          return;
        }
        try {
          let child;
          if (process.platform === 'win32') {
            const winDir = process.env.WINDIR || 'C:\\Windows';
            const explorerPath = fs.existsSync(path.join(winDir, 'explorer.exe'))
              ? path.join(winDir, 'explorer.exe')
              : 'explorer.exe';
            if (isSelect) {
              child = spawn(explorerPath, [`/select,"${target}"`], {
                detached: true,
                stdio: 'ignore',
                windowsVerbatimArguments: true
              });
            } else {
              child = spawn(explorerPath, [target], {
                detached: true,
                stdio: 'ignore'
              });
            }
          } else if (process.platform === 'darwin') {
            child = spawn('open', isSelect ? ['-R', target] : [target], {
              detached: true,
              stdio: 'ignore'
            });
          } else {
            child = spawn('xdg-open', [isSelect ? path.dirname(target) : target], {
              detached: true,
              stdio: 'ignore'
            });
          }
          if (child) child.unref();
        } catch {}
      };

      // API: Open Downloads/uDrop Folder in Windows Explorer / OS Manager (Loopback-only)
      if (req.method === 'POST' && pathname === '/api/open-folder') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        const downloadDir = getDownloadDirectory();
        openInExplorer(downloadDir, false);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: downloadDir }));
        return;
      }

      // API: Open & Highlight specific received file in File Explorer (Loopback + download root guard)
      if (req.method === 'POST' && pathname === '/api/open-file') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const downloadRoot = path.resolve(getDownloadDirectory());
            const candidate = data.filePath
              ? path.resolve(data.filePath)
              : (data.fileName ? path.join(downloadRoot, path.basename(data.fileName)) : downloadRoot);

            const insideRoot = (candidate === downloadRoot) ||
              candidate.toLowerCase().startsWith((downloadRoot + path.sep).toLowerCase());
            if (!insideRoot) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Path outside uDrop download directory' }));
              return;
            }

            if (fs.existsSync(candidate)) {
              openInExplorer(candidate, candidate !== downloadRoot);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, targetPath: candidate }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // API: UXIOM Mesh Ring State + latest phone redirect timestamp
      if (req.method === 'GET' && pathname === '/api/mesh/ring') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ring: getMeshRing(), recentScanAt: lastQrScanAt }));
        return;
      }

      // API: Complete live overlay state snapshot (Loopback-only for native Windows Glass Dashboard)
      if (req.method === 'GET' && pathname === '/api/overlay/state') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify({
          ring: getMeshRing(),
          recentScanAt: lastQrScanAt,
          activeTransfers: Array.from(activeTransfers.values()).map(t => ({
            fileId: t.fileId,
            fileName: t.fileName,
            fileSize: t.fileSize,
            receivedBytes: t.receivedBytes,
            percent: t.percent,
            speedBps: t.speedBps,
            fromSlot: t.fromSlot,
            queueIndex: t.queueIndex,
            totalFiles: t.totalFiles
          })),
          recentCompleted,
          outboundFiles: getOutboundFiles()
        }));
        return;
      }

      // API: Join UXIOM Mesh Ring
      if (req.method === 'POST' && pathname === '/api/mesh/join') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const isLocalHost = isLoopbackRequest(req) && data.isHostDashboard === true;
            const result = registerMeshNode(data.clientId, data.userAgent || req.headers['user-agent'], { isLocalHost });
            // Auto-launch browser Dynamic Island HUD only in CLI mode when native Windows overlay isn't active
            if (!isLocalHost && !hasActiveLocalViewer() && process.env.UDROP_NATIVE_OVERLAY !== '1') {
              launchDesktopOverlay(port);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, ...result }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Leave UXIOM Mesh Ring
      if (req.method === 'POST' && pathname === '/api/mesh/leave') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const success = unregisterMeshNode(data.clientId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Real-time Ring SSE Stream
      if (req.method === 'GET' && pathname === '/api/mesh/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        addSSEClient(res, req);
        return;
      }

      // API: Mesh Node Heartbeat
      if (req.method === 'POST' && pathname === '/api/mesh/heartbeat') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (data.clientId) updateHeartbeat(data.clientId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid heartbeat' }));
          }
        });
        return;
      }

      // API: List outbound files shared by PC
      if (req.method === 'GET' && pathname === '/api/files') {
        const files = getOutboundFiles();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
        return;
      }

      // API: Register a host file from Windows Explorer / Tray (Loopback-only security boundary)
      if (req.method === 'POST' && pathname === '/api/outbound/register') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        let body = '';
        let tooLarge = false;
        req.on('data', (c) => {
          body += c;
          if (body.length > 65536) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (tooLarge) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload too large' }));
            return;
          }
          try {
            const data = JSON.parse(body || '{}');
            if (!data.filePath || typeof data.filePath !== 'string') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'filePath is required' }));
              return;
            }
            const registered = registerOutboundFile(data.filePath);
            broadcastHostTransferEvent({
              type: 'outbound_updated',
              file: { id: registered.id, name: registered.name, size: registered.size }
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, file: { id: registered.id, name: registered.name, size: registered.size } }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Unregister an outbound host file (Loopback-only)
      if (req.method === 'DELETE' && pathname.startsWith('/api/outbound/')) {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        const id = decodeURIComponent(pathname.replace('/api/outbound/', ''));
        const removed = unregisterOutboundFile(id);
        broadcastHostTransferEvent({ type: 'outbound_updated' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: removed }));
        return;
      }

      // API: Graceful host shutdown triggered by Tray ON/OFF switch (Loopback-only)
      if (req.method === 'POST' && pathname === '/api/shutdown') {
        if (!isLoopbackRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Loopback access only' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, shuttingDown: true }));
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close();
        if (onShutdown) {
          onShutdown(server);
        }
        return;
      }

      // API: Download outbound file with Range streaming
      if (req.method === 'GET' && pathname.startsWith('/api/download/')) {
        const id = pathname.replace('/api/download/', '');
        const file = getOutboundFile(id);
        if (!file || !fs.existsSync(file.path)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }

        const stat = fs.statSync(file.path);
        const range = req.headers.range;

        // Support Range headers for resumable downloads & media streaming
        const safeAsciiName = String(file.name || 'download').replace(/[\r\n"\\]/g, '_');
        const safeName = encodeURIComponent(file.name);
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          let start = parseInt(parts[0], 10);
          let end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

          if (isNaN(start)) {
            start = stat.size - parseInt(parts[1], 10);
            end = stat.size - 1;
          }

          if (start >= stat.size || end >= stat.size || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
            res.end();
            return;
          }

          const chunksize = (end - start) + 1;
          const stream = fs.createReadStream(file.path, { start, end, highWaterMark: 128 * 1024 });

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${safeName}`
          });
          stream.pipe(res);
        } else {
          res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': stat.size,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${safeName}`
          });
          fs.createReadStream(file.path, { highWaterMark: 128 * 1024 }).pipe(res);
        }
        return;
      }

      // API: Init chunked upload
      if (req.method === 'POST' && pathname === '/api/upload/init') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const session = await initUploadSession(data);
            const now = Date.now();
            activeTransfers.set(session.fileId, {
              fileId: session.fileId,
              fileName: session.fileName,
              fileSize: session.fileSize,
              receivedBytes: 0,
              percent: 0,
              speedBps: 0,
              fromSlot: data.fromSlot || 'Node',
              queueIndex: data.queueIndex || 1,
              totalFiles: data.totalFiles || 1,
              updatedAt: now,
              _lastTime: now,
              _lastBytes: 0
            });
            broadcastHostTransferEvent({
              type: 'host_transfer_start',
              fileId: session.fileId,
              fileName: session.fileName,
              fileSize: session.fileSize,
              totalChunks: session.totalChunks,
              fromSlot: data.fromSlot || 'Node',
              queueIndex: data.queueIndex || 1,
              totalFiles: data.totalFiles || 1,
              timestamp: now
            });

            // Ensure browser Dynamic Island HUD only launches when native Windows overlay isn't active
            if (!hasActiveLocalViewer() && process.env.UDROP_NATIVE_OVERLAY !== '1') {
              launchDesktopOverlay(port);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              session: {
                fileId: session.fileId,
                fileName: session.fileName,
                fileSize: session.fileSize,
                totalChunks: session.totalChunks,
                chunkSize: session.chunkSize
              }
            }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Check status (resumability)
      if (req.method === 'GET' && pathname.startsWith('/api/upload/status/')) {
        const fileId = pathname.replace('/api/upload/status/', '');
        const status = getUploadStatus(fileId);
        if (!status) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }

      // API: Receive chunk (Direct offset write + real-time byte SSE & overlay tracking)
      if (req.method === 'PUT' && pathname.startsWith('/api/upload/chunk/')) {
        const parts = pathname.replace('/api/upload/chunk/', '').split('/');
        const fileId = parts[0];
        const chunkIndex = parseInt(parts[1], 10);

        const updateTrackerBytes = (fileIdKey, bytesNow, totalBytes) => {
          const entry = activeTransfers.get(fileIdKey);
          if (!entry) return;
          const now = Date.now();
          const dt = (now - entry._lastTime) / 1000;
          if (dt >= 0.35 && bytesNow >= entry._lastBytes) {
            entry.speedBps = Math.round((bytesNow - entry._lastBytes) / dt);
            entry._lastTime = now;
            entry._lastBytes = bytesNow;
          }
          entry.receivedBytes = bytesNow;
          entry.percent = totalBytes > 0 ? Math.min(100, Math.round((bytesNow / totalBytes) * 100)) : 100;
          entry.updatedAt = now;
        };

        const chunks = [];
        let reqBytes = 0;
        let isAborted = false;
        let releasedInFlight = false;

        const releaseInFlight = () => {
          if (releasedInFlight) return;
          releasedInFlight = true;
          if (reqBytes > 0) {
            const cur = inFlightSessionBytes.get(fileId) || 0;
            const next = Math.max(0, cur - reqBytes);
            if (next === 0) inFlightSessionBytes.delete(fileId);
            else inFlightSessionBytes.set(fileId, next);
          }
        };

        req.on('aborted', () => {
          isAborted = true;
          releaseInFlight();
        });

        req.on('close', () => {
          if (!req.complete) {
            isAborted = true;
            releaseInFlight();
          }
        });

        req.on('data', (c) => {
          chunks.push(c);
          reqBytes += c.length;
          inFlightSessionBytes.set(fileId, (inFlightSessionBytes.get(fileId) || 0) + c.length);

          const now = Date.now();
          const last = lastBroadcastMap.get(fileId) || 0;
          if (now - last >= 120) {
            const status = getUploadStatus(fileId);
            if (status && status.fileSize > 0) {
              lastBroadcastMap.set(fileId, now);
              const streamed = Math.min(
                status.fileSize,
                (status.receivedBytes || 0) + (inFlightSessionBytes.get(fileId) || 0)
              );
              updateTrackerBytes(fileId, streamed, status.fileSize);
              broadcastHostTransferEvent({
                type: 'host_transfer_progress',
                fileId,
                chunkIndex,
                receivedTotal: status.receivedChunks.length,
                totalChunks: status.totalChunks,
                receivedBytes: streamed,
                totalBytes: status.fileSize,
                timestamp: now
              });
            }
          }
        });

        req.on('end', async () => {
          releaseInFlight();
          if (isAborted) return;
          try {
            const buffer = Buffer.concat(chunks);
            const result = await writeChunk(fileId, chunkIndex, buffer);

            // Throttle SSE progress broadcasts to prevent client/network event loop saturation
            const now = Date.now();
            const last = lastBroadcastMap.get(fileId) || 0;
            const isDone = (result.receivedTotal >= result.totalChunks);
            const status = getUploadStatus(fileId);
            const totalBytes = status ? status.fileSize : 0;
            const activeExtra = inFlightSessionBytes.get(fileId) || 0;
            const receivedBytes = totalBytes > 0
              ? Math.min(totalBytes, (result.receivedBytes || 0) + activeExtra)
              : (result.receivedBytes || 0);

            updateTrackerBytes(fileId, receivedBytes, totalBytes);

            if (isDone || (now - last >= 100)) {
              lastBroadcastMap.set(fileId, now);
              broadcastHostTransferEvent({
                type: 'host_transfer_progress',
                fileId,
                chunkIndex,
                receivedTotal: result.receivedTotal,
                totalChunks: result.totalChunks,
                receivedBytes,
                totalBytes,
                timestamp: now
              });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Complete & finalize upload (Zero stitching lag + Mesh routing!)
      if (req.method === 'POST' && pathname.startsWith('/api/upload/complete/')) {
        const fileId = pathname.replace('/api/upload/complete/', '');
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            let meta = {};
            if (body) {
              try { meta = JSON.parse(body); } catch (e) {}
            }

            const prevEntry = activeTransfers.get(fileId);
            const result = await finalizeUpload(fileId);
            inFlightSessionBytes.delete(fileId);
            lastBroadcastMap.delete(fileId);
            activeTransfers.delete(fileId);
            pushRecentCompleted({
              fileId,
              fileName: result.fileName,
              fileSize: result.fileSize,
              filePath: result.filePath,
              fromSlot: meta.fromSlot || (prevEntry ? prevEntry.fromSlot : 'Node'),
              status: 'completed',
              timestamp: Date.now()
            });
            console.log(chalk.green(`\nReceived file: `) + chalk.cyan.bold(result.fileName) + chalk.gray(` saved to `) + chalk.white(result.filePath));

            // Broadcast host completion event to Dynamic Island HUD
            broadcastHostTransferEvent({
              type: 'host_transfer_complete',
              fileId,
              fileName: result.fileName,
              fileSize: result.fileSize,
              filePath: result.filePath,
              fromSlot: meta.fromSlot || 'Node',
              toSlot: meta.toSlot || 'U',
              timestamp: Date.now()
            });

            // Register as outbound stream
            const outbound = registerOutboundFile(result.filePath);

            // If routed across UXIOM mesh (e.g. iPhone [O] -> Android [X] or [ALL])
            if (meta.toSlot && meta.toSlot !== 'U') {
              console.log(chalk.bold.yellow(`Routing Mesh Stream: `) + chalk.white(`[${meta.fromSlot || 'Node'}] -> [${meta.toSlot}] `) + chalk.dim(`(${result.fileName})`));
              dispatchMeshTransfer({
                fromSlot: meta.fromSlot || 'Node',
                toSlot: meta.toSlot,
                fileName: result.fileName,
                fileSize: result.fileSize,
                downloadUrl: `/api/download/${outbound.id}`
              });
            }

            if (onUploadComplete) onUploadComplete(result);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result, outboundId: outbound.id }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // API: Cancel in-progress upload session & remove partial files
      if (req.method === 'POST' && pathname.startsWith('/api/upload/cancel/')) {
        const fileId = pathname.replace('/api/upload/cancel/', '');
        try {
          const prevEntry = activeTransfers.get(fileId);
          const result = await cancelUploadSession(fileId);
          inFlightSessionBytes.delete(fileId);
          lastBroadcastMap.delete(fileId);
          activeTransfers.delete(fileId);
          if (prevEntry) {
            pushRecentCompleted({
              fileId,
              fileName: prevEntry.fileName,
              fileSize: prevEntry.fileSize,
              filePath: '',
              fromSlot: prevEntry.fromSlot || 'Node',
              status: 'cancelled',
              timestamp: Date.now()
            });
          }
          broadcastHostTransferEvent({
            type: 'host_transfer_cancel',
            fileId,
            timestamp: Date.now()
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Serve Static PWA files (Disk first, In-memory embedded fallback)
      const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      if ((pathname === '/' || cleanPath === 'index.html') && !isLoopbackRequest(req)) {
        lastQrScanAt = Date.now();
        broadcastHostTransferEvent({
          type: 'qr_scanned',
          timestamp: lastQrScanAt,
          userAgent: req.headers['user-agent'] || ''
        });
      }

      let filePath = path.join(PUBLIC_DIR, cleanPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=UTF-8',
        '.css': 'text/css; charset=UTF-8',
        '.js': 'application/javascript; charset=UTF-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (EMBEDDED_ASSETS && EMBEDDED_ASSETS[cleanPath]) {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(EMBEDDED_ASSETS[cleanPath]);
        return;
      }

      if (EMBEDDED_ASSETS && EMBEDDED_ASSETS['index.html']) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(EMBEDDED_ASSETS['index.html']);
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });

  // Low-level TCP optimization: Disable Nagle's algorithm & enable keep-alive
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 0;

  server.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1000);
  });

  server.on('close', () => {
    closeAllSessions().catch(() => {});
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

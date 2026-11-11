# uDrop Wire & Network Protocol Specification

This document specifies the HTTP, SSE, and chunked streaming protocol used by `uDrop` so third-party developers can implement compatible native or CLI clients (Swift, Kotlin, Rust, Python, Go).

All endpoints operate on a single HTTP/1.1 TCP port (default **`4040`**) bound to **`0.0.0.0`**.

---

## 1. Discovery & Connection URLs

1. **QR Code Pairing Payload**:
   The host displays a QR code encoding either:
   - **mDNS URL (default)**: `http://<hostname>.local:4040`
   - **LAN IPv4 fallback (`Use IP`)**: `http://<lan-ipv4>:4040`
   - **Windows Hotspot mode (`--hotspot`)**: `http://192.168.137.1:4040` (after scanning the `WIFI:T:WPA;S:...;P:...;;` QR string)

2. **Host Info Ping — `GET /api/info`**:
   - Response `200 OK` (`application/json`):
     ```json
     {
       "hostname": "host-machine-name",
       "platform": "win32",
       "port": 4040
     }
     ```

3. **QR Matrix Vector Data — `GET /api/qr.matrix?mode=mdns|ip`**:
   - Returns `{ size, rows, mode, connectUrl, mdnsUrl, ipUrl, maskedLabel }` where `rows` is an array of `size` binary strings (`"1"` = dark module, `"0"` = quiet space).

---

## 2. UXIOM 5-Node Ring Mesh Coordination

Topology supports up to 5 slots: `["U", "X", "I", "O", "M"]`.
- Slot **`U`** is permanently reserved for the Host Master.
- Mobile/peer clients dynamically claim **`X`**, **`I`**, **`O`**, or **`M`** (`35,000 ms` lease timeout; stale peers are pruned every `15,000 ms` and on joins).

| Method & Path | Access | Request JSON / Behavior | Response |
| :--- | :--- | :--- | :--- |
| `POST /api/mesh/join` | Any peer | `{ "clientId": "uuid", "userAgent": "..." }` *(Loopback + `"isHostDashboard": true` refreshes `U` instead of taking a mobile slot)* | `{ "success": true, "slot": "X", "node": { ... }, "ring": [...] }` |
| `POST /api/mesh/heartbeat` | Any peer | `{ "clientId": "uuid" }` — extends `lastSeen` TTL | `{ "success": true }` |
| `POST /api/mesh/leave` | Any peer | `{ "clientId": "uuid" }` — immediately frees slot | `{ "success": true, "unregistered": true }` |
| `GET /api/mesh/ring` | Any peer | Returns all 5 slots plus `recentScanAt` epoch ms | `{ "ring": [...], "recentScanAt": 1700000000000 }` |

---

## 3. Real-Time Server-Sent Events (`GET /api/mesh/events`)

Clients maintain a persistent `text/event-stream` connection receiving `data: <JSON>\n\n` messages:

- `ring_update`: `{ type: "ring_update", ring: [...] }`
- `qr_scanned`: `{ type: "qr_scanned", timestamp, userAgent }` — broadcast when a non-loopback device opens `GET /` (triggers Kinetic QR dismantle into Live Dashboard)
- `incoming_mesh_transfer`: Broadcast when a peer routes a file to another slot (`toSlot` = `"X" | "I" | "O" | "M" | "ALL"`):
  ```json
  {
    "type": "incoming_mesh_transfer",
    "transfer": {
      "fromSlot": "X",
      "toSlot": "I",
      "fileName": "IMG_4092.jpg",
      "fileSize": 3145728,
      "downloadUrl": "/api/download/494d475f_...",
      "category": "photo",
      "badge": "PHOTO",
      "mime": "image/jpeg",
      "inlineSafe": true,
      "timestamp": 1700000000000
    }
  }
  ```
- `outbound_updated`: `{ type: "outbound_updated" }` — notifies peers to re-fetch `GET /api/files`
- `host_transfer_progress`: `{ type: "host_transfer_progress", fileId, chunkIndex, receivedTotal, totalChunks, receivedBytes, totalBytes, timestamp }`
- `host_transfer_complete` / `host_transfer_cancelled`: `{ type: "host_transfer_complete" | "host_transfer_cancelled", fileId, fileName, ... }`
- `open_qr_modal`: `{ type: "open_qr_modal" }`

---

## 4. Resumable Direct-Offset Chunk Upload Protocol

Clients upload files directly to the host's `Downloads/uDrop` folder using deterministic sparse offsets (`chunkIndex * chunkSize`):

1. **Initialize Session — `POST /api/upload/init`**:
   - Request JSON:
     ```json
     {
       "fileId": "unique_id_123",
       "fileName": "video_4k.mov",
       "fileSize": 104857600,
       "totalChunks": 13,
       "chunkSize": 8388608
     }
     ```
   - Constraints: `fileSize >= 0`, `totalChunks >= 1`, `chunkSize >= 1` (`fileName` is sanitized via `path.basename`).
   - Response `200 OK`: `{ "success": true, "session": { "fileId", "fileName", "totalChunks", "receivedChunks": [] } }`.

2. **Check Resume State — `GET /api/upload/status/:fileId`**:
   - Response `200 OK`: `{ "exists": true, "receivedChunks": [0, 1, 2], "receivedBytes": 25165824, "totalChunks": 13, "fileSize": 104857600 }`.

3. **Upload Slice — `PUT /api/upload/chunk/:fileId/:chunkIndex`**:
   - Body: raw binary bytes for slice `chunkIndex` (`0 <= chunkIndex < totalChunks`).
   - Optional telemetry headers:
     - `x-from-slot`: source slot letter (e.g. `"X"`)
     - `x-queue-index`: `1`-based batch index
     - `x-total-files`: total files in batch
   - Writes directly to `chunkIndex * chunkSize` via open `w+` descriptor; rejects out-of-range indices.

4. **Finalize & Bridge — `POST /api/upload/complete/:fileId`**:
   - Optional JSON body: `{ "fromSlot": "X", "toSlot": "U" | "I" | "ALL" }`
   - Closes file handle cleanly and registers file outbound if `toSlot !== "U"`, emitting `incoming_mesh_transfer` SSE events.

5. **Cancel & Purge — `POST /api/upload/cancel/:fileId`**:
   - Closes handle, deletes partial file on disk, deletes session state, broadcasts `host_transfer_cancelled`.

---

## 5. Outbound Sharing & Range Streaming (`206 Partial Content`)

1. **List Shared Files — `GET /api/files`**:
   - Returns array of `{ id, name, size, category, badge, mime, inlineSafe }`.
   - `category`: `"photo" | "video" | "contact" | "pdf" | "audio" | "archive" | "doc" | "file"`.

2. **Stream / Preview File — `GET /api/download/:id` (optional `?inline=1`)**:
   - Sets accurate `Content-Type` (`image/jpeg`, `video/mp4`, `text/vcard; charset=utf-8`, `application/pdf`, etc.).
   - Sends `Content-Disposition: attachment` by default, or `Content-Disposition: inline` **only** when `?inline=1` is requested and the extension is marked `inlineSafe` (SVG/HTML/JS are never served `inline`).
   - Supports HTTP `Range: bytes=start-end`, returning **`206 Partial Content`**, `Accept-Ranges: bytes`, `Content-Range`, or `416` on invalid bounds.

---

## 6. Loopback Security Boundary (`127.0.0.1` / `::1` Only)

Host control routes verify `req.socket.remoteAddress` is loopback and return **`403 Forbidden`** to any LAN device:

- `GET /api/overlay/state` — full live snapshot (`ring`, `recentScanAt`, `activeTransfers`, `recentCompleted`, `outboundFiles`)
- `POST /api/outbound/register` — `{ "filePath": "C:\\path\\to\\file" }`
- `DELETE /api/outbound/:id` — unshares outbound file
- `POST /api/open-folder` — opens `Downloads/uDrop`
- `POST /api/open-file` — selects file within `Downloads/uDrop` (enforces download root containment)
- `POST /api/qr/popup` — triggers modal popup
- `POST /api/shutdown` — drains open sessions, closes file handles, and shuts down server cleanly

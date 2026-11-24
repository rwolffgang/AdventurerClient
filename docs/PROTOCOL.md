# How Adventurer Client works

This document describes the app's structure, the network protocol of the FlashForge Adventurer III Pro (firmware v2.x) and the `.gx` file format. The protocol details were worked out against a real printer.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron 12 |
| User interface | Angular 12 |
| Printer communication | Node.js `net` socket (port 8899) |
| Camera | MJPEG stream (port 8080) via `mjpeg-camera` |
| Language | TypeScript |

Source lives under `src/`. The Electron main process entry is `src/electronMain.ts`; the Angular app and printer SDK are under `src/electronApp/`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron main process (electronMain.ts)                │
│  ┌───────────────────────────────────────────────────┐│
│  │  Angular UI (angularApp/)                         ││
│  │    connect-form, status, print, camera, debug …   ││
│  │         │                                         ││
│  │         ▼                                         ││
│  │  PrinterService (angularApp/services/)          ││
│  │    heartbeat, connection state, file naming       ││
│  │         │                                         ││
│  │         ▼                                         ││
│  │  Printer SDK (printerSdk/)                        ││
│  │    Printer, PrinterResponseReader, GcodeToGx      ││
│  └───────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
         │ TCP 8899 (commands + file transfer)
         │ HTTP 8080 (camera MJPEG)
         ▼
   FlashForge Adventurer / Voxel printer
```

### Key modules

- **`printerSdk/printer.ts`** — Low-level socket communication: connect, status queries, file transfer, print commands.
- **`printerSdk/printerResponseReader.ts`** — Parses multi-line text responses from the printer and matches them to pending commands.
- **`printerSdk/gcodeToGx.ts`** — Wraps plain G-code in FlashForge `.gx` container format before upload.
- **`printerSdk/machineCommands.ts`** — G-code command identifiers (`M119`, `M28`, `M29`, `M23`, etc.).
- **`angularApp/services/printerService.ts`** — Injectable service used by UI components; manages connection lifecycle, polling suspend during transfer, upload file naming, and transfer progress state.
- **`printerSdk/curaToFlashforge.ts`** — Rewrites Cura G-code into the subset the Adventurer firmware understands.
- **`stubPrinter/stubPrinter.js`** — Local fake printer for development without hardware.

## Printer Network Protocol

Communication uses a single persistent TCP connection on **port 8899**. Commands are sent as lines prefixed with `~` (for example `~M119`). The printer responds with several text lines followed by `ok`.

### Control and status

| Command | Purpose |
|---------|---------|
| `~M601 S1` | Take control of the printer (required on v2.x firmware; send once per connection) |
| `~M602` | Release control |
| `~M115` | Firmware and machine info |
| `~M119` | Endstop and machine status |
| `~M105` | Nozzle and bed temperatures (Adventurer III Pro returns `T0:24/0 B:14/0`) |
| `~M23 0:/user/<file>` | Start printing a file on internal storage |
| `~M24` / `~M25` / `~M26` | Resume / pause / stop print |

On v2.x firmware the client sends `~M601 S1` immediately after connecting. The printer answers `Control Success` once; a **second** `~M601 S1` on the same TCP connection returns `Control failed.` even though control is already held — that is not a real error. The client tracks control state and skips redundant M601 calls before upload.

### File upload sequence (Adventurer III Pro, firmware v2.x)

This sequence was verified against a real Adventurer III Pro (firmware v2.0.9).

```
Client                              Printer
  │ ~M601 S1                    →   Control Success (once per connection)
  │ ~M28 <size> 0:/user/<name>  →   Begin receiving <size> raw bytes
  │ <raw file bytes>            →   Written directly to SD (no framing)
  │  (brief settle delay)       →   Printer leaves binary-receive mode
  │ ~M29                        →   Save file, respond "Done saving file."
  │ ~M23 0:/user/<name>         →   Start print
```

**Critical protocol details:**

1. **Raw bytes after M28** — After `~M28`, the printer expects exactly `<size>` raw file bytes with **no** `5A5AA5A5` packet headers, CRC fields, or per-chunk acknowledgements. If chunks are wrapped in 16-byte frames (as older FlashForge firmware expected), the frame headers end up in the file and the printer reports “file format error” when printing it.

2. **TCP back-pressure** — Files are sent in 64 KB chunks. Each chunk waits for the socket `drain` event so the upload is paced to what the printer can consume; if a chunk can't be flushed within 30 seconds the upload fails instead of hanging. The socket uses `TCP_NODELAY` so the final `~M29` command is not coalesced with the last file chunk in a single packet.

3. **Settle delay before M29** — After the last byte is sent, the client waits before sending `~M29` (500 ms plus 1 s per MB, at most 30 s). Sending M29 immediately can leave the printer in binary-receive mode so the save command is never processed and the upload hangs at 100% with no response.

4. **No commands during M29** — While the printer finalises the save after `~M29`, **any other command on the same connection** (status polls, heartbeat, etc.) can cause the printer to never send the M29 acknowledgement. The client then hangs at 100% upload and never sends `~M23` to start the print.

5. **Camera competes for bandwidth** — The printer is a small embedded device. Streaming MJPEG from port 8080 while uploading on port 8899 can starve the upload socket and stall mid-transfer. The client pauses the camera for the duration of a file transfer.

6. **Polling must be suspended** — Besides the 5-second heartbeat (`~M119`), the status UI polls every 2 seconds. Both must be paused for the entire transfer-and-print flow. `PrinterService.SuspendPollingAsync()` waits for in-flight polls to finish before starting a transfer. The status component checks `IsPollingSuspended()` before refreshing.

7. **Upload file names** — Names that start with an M-code pattern (for example `M92 Grip.gx`) are renamed on upload (`file_M92_Grip.gx`) because the firmware can mis-parse them during M28/M29. Other names, including spaces (for example `Belt Buckle v3.gx`), are sent unchanged.

8. **Response matching** — Command acknowledgements register a pending listener before the command is sent. M29 completion is recognised from `Done saving file.` even when the printer omits the usual `CMD M29 Received.` line.

### Accepted file types

The UI accepts `.g`, `.gcode`, and `.gx` files. All uploads are stored on the printer as `.gx` regardless of the source extension.

## The `.gx` File Format

FlashForge `.gx` files are a container around G-code with a fixed header, optional thumbnail, and metadata. The Adventurer III Pro accepts plain G-code, but only acknowledges `~M29` quickly for `.gx` files. Plain G-code forces the printer to parse the entire file at M29 (90+ seconds with no acknowledgement), which makes the upload appear stuck at 100%.

The `GcodeToGx` class (`printerSdk/gcodeToGx.ts`) wraps plain G-code when needed:

| Offset | Content |
|--------|---------|
| `0x00` | Magic string `xgcode 1.0\n` + padding |
| `0x10` | Bitmap offset (58) |
| `0x14` / `0x18` | G-code offset for tool 0 and tool 1 |
| `0x1c` | Print time in seconds (from `;TIME:` in G-code header) |
| `0x20` | Filament used in cm (from `;Filament used:` comment) |
| `0x3a` | 80×60 24 bpp BMP thumbnail (flat grey placeholder) |
| After header | Raw G-code body |

Files that already begin with the `xgcode 1.0` magic pass through unchanged.

## UI Components (brief)

| Component | Role |
|-----------|------|
| `connect-form` | Enter printer IP and connect |
| `status` | Live status, temperatures, print controls; hosts the print and camera panels |
| `print` | Drag-and-drop file upload and print |
| `camera` | MJPEG camera preview |
| `app` | Window header, transfer progress banner, settings panel and dialogs |
| `debug` | Settings panel: camera and auto-connect toggles, log file, raw commands |

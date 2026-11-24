<p align="center">
  <img src="docs/images/icon.png" width="128" alt="Adventurer Client icon">
</p>

<h1 align="center">Adventurer Client</h1>

<p align="center">
  A desktop app for FlashForge Adventurer 3D printers: watch the printer, drop in a G-code file and it prints.
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="720" alt="Adventurer Client showing a printer mid-print, with temperatures, print controls and recent prints">
</p>

## About

Adventurer Client connects to a FlashForge Adventurer printer over your network (Wi-Fi or Ethernet). It replaces the FlashPrint "send to printer" step for people who slice in Cura or another slicer.

This project is based on [**AdventurerClientJS** by Andy Bradford](https://github.com/andycb/AdventurerClientJS). The interface has been rewritten and the upload code reworked for the current printer firmware (v2.x). It's a separate repository without the original's git history, and it doesn't aim to stay compatible with it. Thanks to Andy for the original app and for working out the printer protocol.

## Features

- Live printer status: mode, model, firmware, serial number, build size
- Nozzle and bed temperatures
- Drag-and-drop printing: drop a `.gcode`, `.g` or `.gx` file and it uploads and starts printing
- Pause, resume and stop the current print
- Enclosure light on/off
- Live camera view (optional, in Settings)
- Recent prints list for quick reprints
- Reconnects to the last printer on launch
- Settings panel for sending raw G-code/M-code commands to the printer and opening the log file

## Supported printers

Tested on a **FlashForge Adventurer III Pro running firmware v2.0.9**. Other Adventurer 3 models and the Monoprice Voxel run related firmware and may work, but they haven't been tested. Older firmware that expects the framed (`5A5AA5A5`) upload protocol is not supported.

## Printing from Cura

Plain G-code is converted on the fly before upload:

1. **Firmware fix-ups.** The Adventurer firmware understands only part of Marlin G-code. If the file contains the markers `;End Start` (end of your start G-code) and `;end gcode` (start of your end G-code), the print body between them is rewritten: Z moves get their own line, `G0` becomes `G1`, the feed rate moves to the end of each line, and temperatures are rounded to whole degrees. Files without these markers are left as they are.
2. **`.gx` wrapping.** The file is wrapped in FlashForge's `.gx` container. The printer confirms `.gx` uploads in seconds, but for plain G-code it can take over a minute.

Files that are already `.gx` (for example from FlashPrint) are uploaded unchanged.

## Installing

Download the latest version from the [Releases page](https://github.com/rwolffgang/AdventurerClient/releases/latest):

- **Windows 10 and 11 (64-bit):** `AdventurerClient-win.exe`
- **macOS 12 Monterey or later, Apple silicon (M1 and later):** `AdventurerClient-macarm64.dmg`
- **macOS 12 Monterey or later, Intel:** `AdventurerClient-macx64.dmg`

On macOS, open the `.dmg` and drag **Adventurer Client** into **Applications**.

### Windows: "Windows protected your PC"

The installer isn't code-signed, so SmartScreen may warn on first run. Click **More info**, then **Run anyway**.

### macOS: "Adventurer Client" can't be opened / "Apple could not verify"

The app isn't signed with an Apple Developer ID or notarized, so macOS blocks the first launch:

- **macOS 15 Sequoia and later:** Try to open the app, close the warning, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the message about Adventurer Client. Confirm with **Open Anyway** again.
- **Older macOS:** Right-click **Adventurer Client** in Finder, choose **Open**, then click **Open** in the dialog.

After that it opens normally.

## Building from source

You need [Node.js](https://nodejs.org) 22.12 or newer.

```bash
cd src
npm install
npm run electron
```

To build installers into `src/distPackages`:

```bash
npm run distmac     # .dmg for Intel and Apple silicon
npm run distwin     # NSIS installer for 64-bit Windows
npm run distlinux   # AppImage and .deb
```

For development with live reload, run `npm run electron:dev`.

## Releasing

Pushing a version tag builds the Windows installer and both macOS disk images on GitHub Actions and attaches them to a GitHub release for that tag. The tag sets the app version, so `package.json` doesn't need to be bumped first:

```bash
git tag v1.1.0
git push origin v1.1.0
```

To build the installers without publishing a release, run the **Release** workflow by hand from the Actions tab. The files are then attached to the workflow run.

## Fake printer

A fake printer is included for development without hardware. It speaks the same network protocol as the real printer, including file uploads:

```bash
node stubPrinter/stubPrinter.js
```

Then connect the app to `localhost`.

## Logs

The app writes a log file that is useful when something goes wrong with an upload. Open it from **Settings → Debug**. It lives in the app's data folder:

- macOS: `~/Library/Application Support/adventurerclient/logs/`
- Windows: `%APPDATA%\adventurerclient\logs\`
- Linux: `~/.config/adventurerclient/logs/`

## How it works

[docs/PROTOCOL.md](docs/PROTOCOL.md) describes the app's structure, the printer's network protocol and the `.gx` file format.

## License

[MIT](LICENSE). Original work © 2020 Andy Bradford, changes © 2026 Robert Wolffgang.

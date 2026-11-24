import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';

const isDevelopment = process.env.ELECTRON_DEV === '1';
const devServerUrl = 'http://localhost:4200';

if (isDevelopment) {
  // Restart the app when the compiled main process file changes.
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    awaitWriteFinish: true,
  });
}

const logFileName = 'adventurer-client.log';

function appendMainLog(message: string): void {
  try {
    const logsDirectory = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDirectory, { recursive: true });

    const logFilePath = path.join(logsDirectory, logFileName);
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(logFilePath, timestamp + ' ' + message + os.EOL);
  } catch {
    // Logging must not break the app.
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 700,
    width: 980,
    minHeight: 600,
    minWidth: 820,
    webPreferences: {
      // The renderer talks to the printer over a raw TCP socket and reads
      // G-code files, so it needs Node.js APIs.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  if (isDevelopment) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, '/dist/index.html'),
        protocol: 'file:',
        slashes: true
      }));
  }

  // Open links in the default browser instead of a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url: uri }) => {
    appendMainLog('Opening external link: ' + uri);
    shell.openExternal(uri);
    return { action: 'deny' };
  });
}

// The renderer asks for these once at startup (see electronApp/core/appInfo.ts).
ipcMain.on('app-info', (event) => {
  event.returnValue = {
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
  };
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  appendMainLog('Main process started. Log file: ' + path.join(app.getPath('userData'), 'logs', logFileName));
  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

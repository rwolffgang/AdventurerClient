const { ipcRenderer, webUtils } = window.require('electron');

/**
 * App details that only the Electron main process knows.
 */
export interface AppInfo {
    version: string;
    userDataPath: string;
}

let appInfo: AppInfo | null = null;

/**
 * Returns the app version and data folder, asked from the main process once.
 */
export function GetAppInfo(): AppInfo {
    if (!appInfo) {
        appInfo = ipcRenderer.sendSync('app-info') as AppInfo;
    }

    return appInfo;
}

/**
 * Returns the path on disk of a file from a file picker or drag-and-drop,
 * or an empty string if it has none.
 */
export function GetPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
}

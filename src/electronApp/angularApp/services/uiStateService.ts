import { Injectable } from '@angular/core';
import { DataSaver } from '../../core/dataSaver';
import { PrinterService } from './printerService';

/**
 * Shared UI state for the application shell overlays and display preferences.
 */
@Injectable({
  providedIn: 'root',
})
export class UiStateService {
  constructor(private printerService: PrinterService) {
  }

  /**
   * Whether the settings panel is visible.
   */
  public settingsOpen = false;

  /**
   * Whether the connection lost dialog is visible.
   */
  public connectionDialogOpen = false;

  /**
   * Whether the stop printing confirmation dialog is visible.
   */
  public stopDialogOpen = false;

  /**
   * Whether a reconnect attempt is in progress.
   */
  public isReconnecting = false;

  /**
   * Whether the camera panel should be shown on the main screen.
   */
  public showCamera = DataSaver.GetShowCamera();

  /**
   * Whether the app should auto-connect to the last printer on launch.
   */
  public autoConnectEnabled = DataSaver.GetAutoConnectEnabled();

  /**
   * Opens the settings panel.
   */
  public OpenSettings(): void {
    this.settingsOpen = true;
  }

  /**
   * Closes the settings panel.
   */
  public CloseSettings(): void {
    this.settingsOpen = false;
  }

  /**
   * Toggles camera panel visibility.
   */
  public ToggleCamera(): void {
    this.showCamera = !this.showCamera;
    DataSaver.SetShowCamera(this.showCamera);
    this.printerService.SyncCameraWithUserPreference();
  }

  /**
   * Toggles auto-connect on launch.
   */
  public ToggleAutoConnect(): void {
    this.autoConnectEnabled = !this.autoConnectEnabled;
    DataSaver.SetAutoConnectEnabled(this.autoConnectEnabled);
  }

  /**
   * Opens the stop printing confirmation dialog.
   */
  public OpenStopDialog(): void {
    this.stopDialogOpen = true;
  }

  /**
   * Closes the stop printing confirmation dialog.
   */
  public CloseStopDialog(): void {
    this.stopDialogOpen = false;
  }

  /**
   * Opens the connection lost dialog.
   */
  public OpenConnectionDialog(): void {
    this.connectionDialogOpen = true;
    this.settingsOpen = false;
  }

  /**
   * Closes the connection lost dialog.
   */
  public CloseConnectionDialog(): void {
    this.connectionDialogOpen = false;
    this.isReconnecting = false;
  }
}

import { Component, OnDestroy, OnInit } from '@angular/core';
import { PrinterService } from '../../services/printerService';
import { UiStateService } from '../../services/uiStateService';
import { TransferState } from '../../services/iPrinterService';
import { DataSaver } from '../../../core/dataSaver';
import { ErrorLogger } from '../../../core/errorLogger';

/**
 * Root shell component hosting the application chrome and overlays.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {

  /**
   * Whether the printer is currently connected.
   */
  public IsConnected = false;

  /**
   * The connected printer IP address.
   */
  public ConnectedAddress = '';

  /**
   * The connected printer model name shown in the titlebar.
   */
  public PrinterModel = '';

  /**
   * Current file transfer state for the banner.
   */
  public TransferState: TransferState;

  /**
   * Whether the transfer banner should be visible.
   */
  public ShowBanner = false;

  /**
   * Banner title text.
   */
  public BannerTitle = '';

  /**
   * Whether the banner includes a progress bar.
   */
  public BannerHasBar = false;

  /**
   * Banner progress percentage.
   */
  public BannerPercent = 0;

  /**
   * Banner meta text shown on the right.
   */
  public BannerMeta = '';

  /**
   * Initializes a new instance of the AppComponent class.
   */
  constructor(
    public UiState: UiStateService,
    private printerService: PrinterService) {
    this.TransferState = this.printerService.GetTransferState();
    this.printerService.ConnectionStateChanged.Register(this.OnPrinterStateChanged, this);
    this.printerService.ConnectionError.Register(this.OnPrinterConnectionError, this);
    this.printerService.TransferStateChanged.Register(this.OnTransferStateChanged, this);
  }

  /**
   * Invoked when the Angular component is initialized.
   */
  ngOnInit(): void {
    this.IsConnected = this.printerService.GetIsConnected();
    this.UpdateConnectionInfo();
    this.UpdateBanner();
  }

  /**
   * Invoked when the Angular component is destroyed.
   */
  ngOnDestroy(): void {
    this.printerService.ConnectionStateChanged.Unregister(this.OnPrinterStateChanged);
    this.printerService.ConnectionError.Unregister(this.OnPrinterConnectionError);
    this.printerService.TransferStateChanged.Unregister(this.OnTransferStateChanged);
  }

  /**
   * Opens the settings panel.
   */
  public OpenSettings(): void {
    this.UiState.OpenSettings();
  }

  /**
   * Closes the settings panel.
   */
  public CloseSettings(): void {
    this.UiState.CloseSettings();
  }

  /**
   * Disconnects from the printer and returns to the connect screen.
   */
  public Disconnect(): void {
    DataSaver.SetSkipAutoConnect(true);
    this.UiState.CloseSettings();
    this.UiState.CloseConnectionDialog();
    this.UiState.CloseStopDialog();
    this.printerService.Disconnect();
    this.IsConnected = false;
    this.ConnectedAddress = '';
    this.PrinterModel = '';
    this.UpdateBanner();
  }

  /**
   * Closes the stop printing dialog.
   */
  public CloseStopDialog(): void {
    this.UiState.CloseStopDialog();
  }

  /**
   * Stops the current print after confirmation.
   */
  public async ConfirmStopPrinting(): Promise<void> {
    try {
      await this.printerService.StopPrintingAsync();
    } catch (error) {
      ErrorLogger.NonFatalError(error);
    } finally {
      this.UiState.CloseStopDialog();
    }
  }

  /**
   * Returns to the connect screen from the connection dialog.
   */
  public CancelConnectionDialog(): void {
    this.UiState.CloseConnectionDialog();
  }

  /**
   * Attempts to restore the printer connection.
   */
  public async Reconnect(): Promise<void> {
    const startTime = new Date().getTime();

    try {
      this.UiState.isReconnecting = true;
      await this.printerService.ReconnectAsync();
      this.UiState.CloseConnectionDialog();
    } catch (error) {
      const endTime = new Date().getTime();
      const duration = endTime - startTime;
      const delay = Math.max(0, 800 - duration);

      setTimeout(() => {
        this.UiState.isReconnecting = false;
      }, delay);
    }
  }

  /**
   * Invoked when the printer connection state changes.
   */
  private OnPrinterStateChanged(connected: boolean): void {
    this.IsConnected = connected;
    this.UpdateConnectionInfo();

    if (!connected) {
      this.UiState.CloseConnectionDialog();
      this.UiState.CloseStopDialog();
      this.UpdateBanner();
    }
  }

  /**
   * Invoked when the printer has a connection error.
   */
  private OnPrinterConnectionError(error: Error): void {
    ErrorLogger.NonFatalError(error);
    this.UiState.OpenConnectionDialog();
  }

  /**
   * Updates titlebar connection details.
   */
  private UpdateConnectionInfo(): void {
    this.ConnectedAddress = this.printerService.GetConnectedAddress() ?? '';

    if (!this.IsConnected) {
      this.PrinterModel = '';
      return;
    }

    void this.printerService.GetFirmwareVersionAsync()
      .then(firmwareInfo => {
        this.PrinterModel = firmwareInfo.MachineType;
      })
      .catch(error => {
        ErrorLogger.NonFatalError(error);
      });
  }

  /**
   * Updates the transfer banner when progress changes.
   */
  private OnTransferStateChanged(state: TransferState): void {
    this.TransferState = state;
    this.UpdateBanner();
  }

  /**
   * Recomputes banner visibility and content.
   */
  private UpdateBanner(): void {
    const state = this.TransferState;
    this.ShowBanner = this.IsConnected && state.active && state.phase !== 'idle';

    switch (state.phase) {
      case 'uploading':
        this.BannerTitle = 'Uploading ' + state.fileName;
        this.BannerHasBar = true;
        this.BannerPercent = Math.round(state.progress * 100);
        this.BannerMeta = this.BannerPercent + '%';
        break;
      case 'saving':
        this.BannerTitle = 'Saving ' + state.fileName + ' on the printer…';
        this.BannerHasBar = false;
        this.BannerMeta = '';
        break;
      case 'printing':
        this.BannerTitle = 'Starting print…';
        this.BannerHasBar = false;
        this.BannerMeta = '';
        break;
      case 'complete':
        this.BannerTitle = 'Print complete';
        this.BannerHasBar = false;
        this.BannerMeta = 'Done';
        break;
      case 'error':
        this.BannerTitle = state.errorMessage ?? 'Upload failed';
        this.BannerHasBar = false;
        this.BannerMeta = '';
        break;
      default:
        this.BannerTitle = '';
        this.BannerHasBar = false;
        this.BannerMeta = '';
        break;
    }
  }
}

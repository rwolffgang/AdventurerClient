import { Component, OnDestroy, OnInit } from '@angular/core';
import { PrinterService } from '../../services/printerService';
import { UiStateService } from '../../services/uiStateService';
import { TransferState } from '../../services/iPrinterService';
import { ErrorLogger } from '../../../core/errorLogger';

/**
 * The printer status component for the main connected screen.
 */
@Component({
  selector: 'app-status',
  templateUrl: './status.component.html',
  styleUrls: ['./status.component.css']
})
export class StatusComponent implements OnInit, OnDestroy {
  public PrinterStatus: string;
  public MoveMode: string;
  public BuildVolume: string;
  public FirmwareVersion: string;
  public SerialNumber: string;
  public PrinterName: string;
  public BuildPlateTemp = '0';
  public BuildPlateTargetTemp = '0';
  public Tool0Temp = '0';
  public Tool0TargetTemp = '0';
  public PrintPaused = false;
  public PrintStateLoaded = false;
  public IsPrinting = false;

  public StatusLabel = 'Idle';
  public StatusColor = '#8A827B';
  public StatusPillBackground = 'rgba(138, 130, 123, 0.12)';
  public ModeLabel = 'Ready';
  public BuildVolumeLabel = '';
  public ShowTargetTemperatures = false;
  public ControlsActive = false;
  public NozzlePercent = 0;
  public BedPercent = 0;
  public PrintPercentLabel = '—';
  public ProgressRingBackground = 'conic-gradient(#F0EBE6 0%, #F0EBE6 100%)';
  public CurrentFileName = '';
  public PrintNote = '';
  public LightOn = false;
  public LightTogglePending = false;

  private ignorePrinterLightStatus = false;
  private refreshInterval: NodeJS.Timeout;
  private transferState: TransferState;

  constructor(
    public UiState: UiStateService,
    private printerService: PrinterService) {
    this.transferState = this.printerService.GetTransferState();
    this.printerService.TransferStateChanged.Register(this.OnTransferStateChanged, this);
  }

  ngOnInit(): void {
    this.UpdateStatusText();
    this.refreshInterval = setInterval(() => {
      if (!this.printerService.IsPollingSuspended()) {
        this.UpdateStatusText();
      }
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.printerService.TransferStateChanged.Unregister(this.OnTransferStateChanged);
  }

  public OpenStopPrintingDialog(): void {
    this.UiState.OpenStopDialog();
  }

  public async PausePrinting(): Promise<void> {
    try {
      await this.printerService.PausePrintingAsync();
    } catch (error) {
      ErrorLogger.NonFatalError(error);
    }
  }

  public async ResumePrinting(): Promise<void> {
    try {
      await this.printerService.ResumePrintingAsync();
    } catch (error) {
      ErrorLogger.NonFatalError(error);
    }
  }

  public async ToggleLight(): Promise<void> {
    if (this.LightTogglePending) {
      return;
    }

    this.LightTogglePending = true;
    const nextState = !this.LightOn;

    try {
      await this.printerService.SetLightAsync(nextState);
      this.LightOn = nextState;
      this.ignorePrinterLightStatus = true;
    } catch (error) {
      ErrorLogger.NonFatalError(error);
    } finally {
      this.LightTogglePending = false;
    }
  }

  private async UpdateStatusText(): Promise<void> {
    if (this.printerService.IsPollingSuspended()) {
      return;
    }

    try {
      const status = await this.printerService.GetPrinterStatusAsync();
      if (this.printerService.IsPollingSuspended()) {
        return;
      }

      this.PrinterStatus = status.MachineStatus;
      this.MoveMode = status.MoveMode;

      if (!this.ignorePrinterLightStatus && status.LightOn != null) {
        this.LightOn = status.LightOn;
      }

      const firmwareInfo = await this.printerService.GetFirmwareVersionAsync();
      if (this.printerService.IsPollingSuspended()) {
        return;
      }

      this.FirmwareVersion = firmwareInfo.FirmwareVersion;
      this.SerialNumber = firmwareInfo.SerialNumber;
      this.PrinterName = firmwareInfo.MachineType;
      this.BuildVolumeLabel = firmwareInfo.BuildVolume.X + ' × '
        + firmwareInfo.BuildVolume.Y + ' × '
        + firmwareInfo.BuildVolume.Z + ' mm';

      const temperature = await this.printerService.GetTemperatureAsync();
      if (this.printerService.IsPollingSuspended()) {
        return;
      }

      this.Tool0Temp = (temperature.Tool0Temp ?? 0).toString();
      this.Tool0TargetTemp = (temperature.Tool0TargetTemp ?? 0).toString();
      this.BuildPlateTemp = (temperature.BuildPlateTemp ?? 0).toString();
      this.BuildPlateTargetTemp = (temperature.BuildPlateTargetTemp ?? 0).toString();

      this.PrintPaused = status.MoveMode === 'PAUSED';
      this.IsPrinting = this.PrinterStatus === 'BUILDING_FROM_SD';
      this.PrintStateLoaded = true;
      this.UpdateDerivedState();
    } catch (error) {
      if (!this.printerService.IsPollingSuspended()) {
        ErrorLogger.NonFatalError(error);
      }
    }
  }

  private OnTransferStateChanged(state: TransferState): void {
    this.transferState = state;
    this.UpdateDerivedState();
  }

  private UpdateDerivedState(): void {
    const isStarting = this.transferState.phase === 'printing';
    const isDone = this.transferState.phase === 'complete';
    const isHeating = isStarting || this.IsPrinting || this.PrintPaused;

    this.ShowTargetTemperatures = isHeating;
    this.ControlsActive = this.IsPrinting || this.PrintPaused;
    this.NozzlePercent = this.GetTemperaturePercent(Number(this.Tool0Temp), Number(this.Tool0TargetTemp));
    this.BedPercent = this.GetTemperaturePercent(Number(this.BuildPlateTemp), Number(this.BuildPlateTargetTemp));

    if (this.transferState.fileName) {
      this.CurrentFileName = this.transferState.fileName;
    }

    if (this.IsPrinting && !this.PrintPaused) {
      this.StatusLabel = 'Printing';
      this.StatusColor = '#663399';
    } else if (this.PrintPaused) {
      this.StatusLabel = 'Paused';
      this.StatusColor = '#C98A2E';
    } else if (isStarting) {
      this.StatusLabel = 'Starting';
      this.StatusColor = '#663399';
    } else if (isDone) {
      this.StatusLabel = 'Complete';
      this.StatusColor = '#3E8E5A';
    } else {
      this.StatusLabel = 'Idle';
      this.StatusColor = '#8A827B';
    }

    this.StatusPillBackground = this.HexToRgba(this.StatusColor, 0.12);

    if (isHeating) {
      this.ModeLabel = 'Building';
    } else if (isDone) {
      this.ModeLabel = 'Finished';
    } else {
      this.ModeLabel = 'Ready';
    }

    this.PrintPercentLabel = '—';
    this.ProgressRingBackground = 'conic-gradient(#663399 0%, #F0EBE6 0%)';
    this.PrintNote = this.PrintPaused
      ? 'Paused — resume when ready'
      : 'Print in progress';
  }

  private GetTemperaturePercent(current: number, target: number): number {
    if (!Number.isFinite(current) || current <= 0) {
      return 0;
    }

    const maximum = Number.isFinite(target) && target > 0 ? target : 250;
    return Math.max(0, Math.min(100, Math.round((current / maximum) * 100)));
  }

  private HexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const value = parseInt(normalized, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return 'rgba(' + red + ',' + green + ',' + blue + ',' + alpha + ')';
  }
}

import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { PrinterService } from '../../services/printerService';
import { IsTransferBusy, TransferState } from '../../services/iPrinterService';
import { DataSaver, RecentPrintEntry } from '../../../core/dataSaver';
import { GetPathForFile } from '../../../core/appInfo';

const fs = window.require('fs');

interface RecentPrintListItem extends RecentPrintEntry {
  exists: boolean;
}

/**
 * The Print component for sending files to the printer.
 */
@Component({
  selector: 'app-print',
  templateUrl: './print.component.html',
  styleUrls: ['./print.component.css']
})
export class PrintComponent implements OnInit, OnDestroy {
  public ErrorMessage: string;
  public TransferState: TransferState;

  public IsIdle = true;
  public IsUploading = false;
  public IsSaving = false;
  public IsStarting = false;
  public IsDone = false;
  public PrinterIsBuilding = false;
  public DropzoneDisabled = false;
  public UploadPercent = 0;
  public RecentPrints: RecentPrintListItem[] = [];
  public HasRecentPrints = false;
  public ShowRecentPrints = false;

  private doneDismissed = false;
  private refreshInterval: NodeJS.Timeout;
  private buildStateRefreshInFlight = false;

  @ViewChild('fileInput') private fileInput: ElementRef<HTMLInputElement>;

  constructor(
    private printerService: PrinterService,
    private changeDetectorRef: ChangeDetectorRef) {
    this.TransferState = this.printerService.GetTransferState();
  }

  ngOnInit(): void {
    this.printerService.TransferStateChanged.Register(this.OnTransferStateChanged, this);
    this.LoadRecentPrints();
    this.UpdateViewState();
    this.refreshInterval = setInterval(() => {
      void this.UpdatePrinterBuildState();
    }, 2000);
    void this.UpdatePrinterBuildState();
  }

  ngOnDestroy(): void {
    this.printerService.TransferStateChanged.Unregister(this.OnTransferStateChanged);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  public pickFile(): void {
    if (!IsTransferBusy(this.TransferState) && !this.PrinterIsBuilding) {
      this.fileInput.nativeElement.click();
    }
  }

  public uploadFile(event): void {
    const file = event?.[0];
    const path = file ? GetPathForFile(file) : '';

    // Clear the picker so choosing the same file again still fires a change.
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }

    if (path && !IsTransferBusy(this.TransferState) && !this.PrinterIsBuilding) {
      this.doneDismissed = false;
      this.ErrorMessage = null;
      this.printerService.UploadAndPrintAsync(path).catch(() => {
        // Error state is set by the service.
      });
    }
  }

  public PrintAnother(): void {
    this.doneDismissed = true;
    this.ErrorMessage = null;
    this.LoadRecentPrints();
    this.UpdateViewState();
  }

  public reprintFile(filePath: string): void {
    if (this.PrinterIsBuilding) {
      return;
    }

    if (!this.PrintFileExists(filePath) || IsTransferBusy(this.TransferState)) {
      this.LoadRecentPrints();
      return;
    }

    this.doneDismissed = false;
    this.ErrorMessage = null;
    this.printerService.UploadAndPrintAsync(filePath).catch(() => {
      // Error state is set by the service.
    });
  }

  private PrintFileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  private LoadRecentPrints(): void {
    this.RecentPrints = DataSaver.GetRecentPrints().map(entry => ({
      ...entry,
      exists: this.PrintFileExists(entry.filePath),
    }));
    this.HasRecentPrints = this.RecentPrints.length > 0;
    this.ShowRecentPrints = this.HasRecentPrints
      && !this.IsUploading
      && !this.IsSaving
      && !this.IsStarting;
    this.changeDetectorRef.markForCheck();
  }

  private OnTransferStateChanged(state: TransferState): void {
    this.TransferState = state;

    if (IsTransferBusy(state)) {
      this.doneDismissed = false;
    }

    if (state.phase === 'error') {
      this.ErrorMessage = state.errorMessage;
    } else if (IsTransferBusy(state)) {
      this.ErrorMessage = null;
    } else if (state.phase === 'complete') {
      this.ErrorMessage = null;
    }

    this.UpdateViewState();

    if (state.phase === 'idle' || state.phase === 'complete' || state.phase === 'error') {
      this.LoadRecentPrints();
    }
  }

  private async UpdatePrinterBuildState(): Promise<void> {
    if (this.printerService.IsPollingSuspended() || this.buildStateRefreshInFlight) {
      return;
    }

    this.buildStateRefreshInFlight = true;
    try {
      const status = await this.printerService.GetPrinterStatusAsync();
      this.PrinterIsBuilding = status.MachineStatus === 'BUILDING_FROM_SD';
      this.UpdateViewState();
      this.changeDetectorRef.markForCheck();
    } catch {
      // Ignore polling errors here; the shell handles connection failures.
    } finally {
      this.buildStateRefreshInFlight = false;
    }
  }

  private UpdateViewState(): void {
    const state = this.TransferState;

    this.IsUploading = state.phase === 'uploading';
    this.IsSaving = state.phase === 'saving';
    this.IsStarting = state.phase === 'printing';
    this.IsDone = state.phase === 'complete' && !this.doneDismissed;
    this.IsIdle = !this.IsUploading && !this.IsSaving && !this.IsStarting && !this.IsDone;
    this.DropzoneDisabled = this.PrinterIsBuilding;
    this.UploadPercent = Math.round(state.progress * 100);
    this.ShowRecentPrints = this.HasRecentPrints
      && !this.IsUploading
      && !this.IsSaving
      && !this.IsStarting;
  }
}

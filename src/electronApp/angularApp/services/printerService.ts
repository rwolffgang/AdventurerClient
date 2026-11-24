import { Injectable } from '@angular/core';
import { IPrinterService, IsTransferBusy, TransferFileStatus, TransferState } from './iPrinterService';
import { PrinterStatus, TemperatureResponse, FirmwareVersionResponse } from '../../printerSdk/entities';
import { Printer } from '../../printerSdk/printer';
import { PrinterCamera } from '../../printerSdk/printerCamera';
import { ErrorLogger, EventDispatcher } from '../../core';
import { DataSaver } from '../../core/dataSaver';

const path = window.require('path');
const fs = window.require('fs');

/** Milliseconds to wait for in-flight polls to finish before a file transfer. */
const pollingDrainTimeoutMilliseconds = 10000;

/**
 * Builds a printer-safe upload file name. Names that look like G-code commands
 * (for example "M92 Grip") can confuse the firmware during M28/M29.
 * Other names keep their original spelling, including spaces.
 */
function SanitizeUploadFileName(baseName: string): string {
	if (/^M\d/i.test(baseName)) {
		const name = baseName.replace(/\s+/g, '_').replace(/[^\w.-]/g, '_');
		return 'file_' + name + '.gx';
	}

	return baseName + '.gx';
}

/** Sliced print files the printer accepts (all are uploaded as .gx). */
const printableExtensions = ['.gcode', '.g', '.gx'];

/** 3D model formats that have to be sliced before they can be printed. */
const modelExtensions = ['.stl', '.3mf', '.obj', '.amf', '.step', '.stp'];

/**
 * True if the file is sliced G-code the printer can print.
 */
function IsPrintableFile(filePath: string): boolean {
	return printableExtensions.includes(path.extname(filePath).toLowerCase());
}

/**
 * Explains why a file cannot be sent to the printer, or returns null if it can.
 */
function GetUnsupportedFileMessage(filePath: string): string | null {
	if (IsPrintableFile(filePath)) {
		return null;
	}

	const displayName = path.basename(filePath);
	if (modelExtensions.includes(path.extname(filePath).toLowerCase())) {
		return '"' + displayName + '" is a 3D model, not a print file. '
			+ 'Slice it in Cura first, then drop the .gcode file here.';
	}

	return '"' + displayName + '" can\'t be printed. '
		+ 'Only sliced .gcode, .g and .gx files can be sent to the printer.';
}

/**
 * Injectable Printer service for communicating with printers.
 */
@Injectable({
	providedIn: 'root',
})
export class PrinterService implements IPrinterService {
	/**
	 * Indicates that a printer is currently connected.
	 */
	private isConnected: boolean;

	/**
	 * The current printer instance.
	 */
	printer: Printer = null;

	/**
	 * The interval for the heartbeat.
	 */
	heartbeatInterval: NodeJS.Timeout;

	/**
	 * When true, all printer polling is skipped during file transfer.
	 */
	private pollingSuspended = false;

	/**
	 * Count of status/heartbeat operations currently awaiting the printer.
	 */
	private activePollingOperations = 0;

	/**
	 * Current upload/print progress for the header banner.
	 */
	private transferState: TransferState = {
		active: false,
		progress: 0,
		phase: 'idle',
		fileName: '',
		errorMessage: null,
	};

	/** @inheritdoc */
	public readonly TransferStateChanged = new EventDispatcher<TransferState>();

	/** @inheritdoc */
	public GetTransferState(): TransferState {
		return this.transferState;
	}

	/** @inheritdoc */
	public readonly ConnectionStateChanged = new EventDispatcher<boolean>();

	/** @inheritdoc */
	public readonly ConnectionError = new EventDispatcher<Error>();

	/** @inheritdoc */
	public GetIsConnected(): boolean {
		return this.isConnected;
	}

	/** @inheritdoc */
	public GetConnectedAddress(): string | null {
		return this.printer?.printerAddress ?? null;
	}

	/** @inheritdoc */
	public async ConnectAsync(printerAddress: string): Promise<any> {
		this.printer = new Printer(printerAddress);
		await this.printer.ConnectAsync();

		this.isConnected = true;
		this.ConnectionStateChanged.Invoke(true);

		this.SyncCameraWithUserPreference();
		this.StartHeartbeat();
	}

	/**
	 * Starts the keep-alive heartbeat poll.
	 */
	private StartHeartbeat(): void {
		if (this.heartbeatInterval != null) {
			return;
		}

		this.heartbeatInterval = setInterval(async () => {
			if (this.pollingSuspended) {
				return;
			}
			try {
				await this.RunPollingOperation(() => this.printer.GetPrinterStatusAsync());
			}
			catch (e) {
				this.ConnectionError.Invoke(e);
				ErrorLogger.NonFatalError(e);
				if (this.heartbeatInterval) {
					clearInterval(this.heartbeatInterval);
					this.heartbeatInterval = null;
				}
			}
		}, 5000);
	}

	/**
	 * Runs a polling operation and tracks it so SuspendPollingAsync can wait for
	 * in-flight requests to finish before a file transfer starts.
	 */
	private async RunPollingOperation<T>(operation: () => Promise<T>): Promise<T> {
		if (this.pollingSuspended) {
			throw new Error('Printer polling is suspended');
		}

		this.activePollingOperations++;
		try {
			return await operation();
		} finally {
			this.activePollingOperations--;
		}
	}

	/** @inheritdoc */
	public Disconnect() {
		this.DisconnectInternal(true);
	}

	/** @inheritdoc */
	public StopPrintingAsync(): Promise<void> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.printer.StopPrintingAsync();
	}

	/** @inheritdoc */
	public PausePrintingAsync(): Promise<void> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.printer.PausePrintingAsync();
	}

	/** @inheritdoc */
	public ResumePrintingAsync(): Promise<void> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.printer.ResumePrintingAsync();
	}

	/** @inheritdoc */
	public SetLightAsync(on: boolean): Promise<void> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.RunPollingOperation(() => this.printer.SetLightAsync(on));
	}

	/** @inheritdoc */
	public async ReconnectAsync(): Promise<any> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		const address = this.printer.printerAddress;
		this.DisconnectInternal(false);
		await this.ConnectAsync(address);
	}

	/** @inheritdoc */
	public GetPrinterStatusAsync(): Promise<PrinterStatus> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.RunPollingOperation(() => this.printer.GetPrinterStatusAsync());
	}

	/** @inheritdoc */
	public PrintFileAsync(fileName: string, fileSizeBytes?: number): Promise<any> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.printer.PrintFileAsync(fileName, fileSizeBytes);
	}

	/** @inheritdoc */
	public async SuspendPollingAsync(): Promise<void> {
		this.pollingSuspended = true;

		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}

		const deadline = Date.now() + pollingDrainTimeoutMilliseconds;
		while (this.activePollingOperations > 0 && Date.now() < deadline) {
			await new Promise<void>((resolve) => setTimeout(resolve, 25));
		}

		if (this.activePollingOperations > 0) {
			ErrorLogger.Trace('SuspendPollingAsync: timed out waiting for in-flight polls');
		}
	}

	/** @inheritdoc */
	public ResumePolling(): void {
		this.pollingSuspended = false;
		this.StartHeartbeat();
	}

	/** @inheritdoc */
	public IsPollingSuspended(): boolean {
		return this.pollingSuspended;
	}

	/** @inheritdoc */
	public SendDebugCommandAsync(command: string): Promise<string[]> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.RunPollingOperation(() => this.printer.SendDebugCommandAsync(command));
	}

	/** @inheritdoc */
	public GetFirmwareVersionAsync(): Promise<FirmwareVersionResponse> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.RunPollingOperation(() => this.printer.GetFirmwareVersionAsync());
	}

	/** @inheritdoc */
	public GetTemperatureAsync(): Promise<TemperatureResponse> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.RunPollingOperation(() => this.printer.GetTemperatureAsync());
	}

	/** @inheritdoc */
	public StoreFileAsync(filePath: string): TransferFileStatus {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		const unsupportedFileMessage = GetUnsupportedFileMessage(filePath);
		if (unsupportedFileMessage != null) {
			throw new Error(unsupportedFileMessage);
		}

		const pathInfo = path.parse(filePath);
		const fileName = SanitizeUploadFileName(pathInfo.name);

		let result = this.printer.StoreFileAsync(filePath, fileName) as TransferFileStatus
		result.OriginName = pathInfo.name + pathInfo.ext
		result.SaveName = fileName
		result.FileSizeBytes = fs.statSync(filePath).size

		return result;
	}

	/** @inheritdoc */
	public async UploadAndPrintAsync(filePath: string): Promise<void> {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		if (IsTransferBusy(this.transferState)) {
			throw new Error('A file transfer is already in progress');
		}

		const pathInfo = path.parse(filePath);
		const displayName = pathInfo.name + pathInfo.ext;

		// Reject models and other non-gcode files before touching the printer,
		// and keep them out of the recent prints list.
		const unsupportedFileMessage = GetUnsupportedFileMessage(filePath);
		if (unsupportedFileMessage != null) {
			ErrorLogger.Trace('PrinterService::UploadAndPrintAsync - Rejected ' + displayName + ': not a print file');
			this.UpdateTransferState({
				active: true,
				progress: 0,
				phase: 'error',
				fileName: displayName,
				errorMessage: unsupportedFileMessage,
			});
			throw new Error(unsupportedFileMessage);
		}

		DataSaver.SaveRecentPrint(filePath, displayName);

		this.UpdateTransferState({
			active: true,
			progress: 0,
			phase: 'uploading',
			fileName: displayName,
			errorMessage: null,
		});

		await this.SuspendPollingAsync();

		// Once every byte is sent the printer still has to finish writing and
		// confirm the save, which takes up to a minute for large files.
		const onProgress = (value: number) => {
			this.UpdateTransferState({ progress: value, phase: value >= 1 ? 'saving' : 'uploading' });
		};

		try {
			ErrorLogger.Trace('PrinterService::UploadAndPrintAsync - Storing file');
			const transferStatus = this.StoreFileAsync(filePath);
			transferStatus.Progress.Register(onProgress);
			try {
				await transferStatus.Promise;
			} finally {
				transferStatus.Progress.Unregister(onProgress);
			}

			this.UpdateTransferState({ progress: 1, phase: 'printing' });
			ErrorLogger.Trace('PrinterService::UploadAndPrintAsync - Printing file');
			await this.PrintFileAsync(transferStatus.SaveName, transferStatus.FileSizeBytes);

			this.UpdateTransferState({ active: true, progress: 1, phase: 'complete', errorMessage: null });
			setTimeout(() => {
				if (this.transferState.phase === 'complete') {
					this.UpdateTransferState({
						active: false,
						progress: 0,
						phase: 'idle',
						fileName: '',
						errorMessage: null,
					});
				}
			}, 3000);
		}
		catch (error) {
			ErrorLogger.NonFatalError(error);
			const reason = error instanceof Error ? error.message : String(error);
			this.UpdateTransferState({
				active: true,
				phase: 'error',
				errorMessage: 'Failed to send file to printer. ' + reason,
			});
			throw error;
		}
		finally {
			this.ResumePolling();
		}
	}

	/**
	 * Updates transfer state and notifies subscribers.
	 */
	private UpdateTransferState(changes: Partial<TransferState>): void {
		this.transferState = { ...this.transferState, ...changes };
		this.TransferStateChanged.Invoke(this.transferState);
	}

	/** @inheritdoc */
	GetCamera(): PrinterCamera {
		if (this.printer == null) {
			throw new Error('Cannot call this method before calling and awaiting ConnectAsync()');
		}

		return this.printer.PrinterCamera;
	}

	/**
	 * Applies the saved camera visibility preference to the active connection.
	 */
	public SyncCameraWithUserPreference(): void {
		if (this.printer == null) {
			return;
		}

		this.printer.PrinterCamera.SetUserCameraEnabled(DataSaver.GetShowCamera());
	}

	/**
	 * Disconnects from the current printer.
	 * @param raiseEvents Indicates is connection state changed events should be raised.
	 */
	private DisconnectInternal(raiseEvents: boolean) {
		if (this.printer != null) {
			this.printer.Disconnect();
			this.printer = null;
		}

		this.isConnected = false;
		this.pollingSuspended = false;

		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}

		this.UpdateTransferState({
			active: false,
			progress: 0,
			phase: 'idle',
			fileName: '',
			errorMessage: null,
		});

		if (raiseEvents) {
			this.ConnectionStateChanged.Invoke(false);
		}
	}
}

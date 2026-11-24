import { PrinterStatus, FirmwareVersionResponse, TemperatureResponse } from '../../printerSdk/entities';
import { PrinterCamera } from '../../printerSdk/printerCamera'
import { EventDispatcher, PromiseWithProgress } from '../../core';


export class TransferFileStatus extends PromiseWithProgress<void> {
	public OriginName :string
	public SaveName :string
	public FileSizeBytes :number
}

/**
 * Describes in-progress file upload and print state shown in the app header.
 */
export type TransferPhase = 'idle' | 'uploading' | 'saving' | 'printing' | 'complete' | 'error';

export interface TransferState {
	active: boolean;
	progress: number;
	phase: TransferPhase;
	fileName: string;
	errorMessage: string | null;
}

/**
 * True while a file is being uploaded, saved or started. A new upload has to
 * wait; after 'complete' or 'error' the next one can start right away.
 */
export function IsTransferBusy(state: TransferState): boolean {
	return state.phase === 'uploading' || state.phase === 'saving' || state.phase === 'printing';
}

/**
 * Interface fot the printer service.
 */
export interface IPrinterService {

    /**
     * Invoked when the printer connection state changes.
     */
    ConnectionStateChanged: EventDispatcher<boolean>;

    /**
     * Invoked when there is an error communicating with the printer.
     */
    ConnectionError: EventDispatcher<Error>;

    /**
     * Gets a value indicating if the client is currently connected to a printer.
     */
    GetIsConnected(): boolean;

    /**
     * Gets the address of the currently connected printer, if any.
     */
    GetConnectedAddress(): string | null;

    /**
     * Attempts to connect to a printer.
     * @param printerAddress The address of the printer.
     */
    ConnectAsync(printerAddress: string): Promise<any>;

    /**
     * Disconnects from the current printer.
     */
    Disconnect(): void;

    /**
     * Stops the printing.
     */
    StopPrintingAsync(): Promise<void>;

    /**
     * Pauses the printing.
     */
    PausePrintingAsync(): Promise<void>;

    /**
     * Resumes the printing.
     */
    ResumePrintingAsync(): Promise<void>;


    /**
     * Resets the connection and attempts to reconnect to the printer.
     */
    ReconnectAsync(): Promise<any>;

    /**
     * Requests the current status from the printer.
     */
    GetPrinterStatusAsync(): Promise<PrinterStatus>;

    /**
     * Sends a command to the printer.
     * @param command The command.
     */
    SendDebugCommandAsync(command: string): Promise<string[]>;

    /**
     * Turns the enclosure light on or off.
     */
    SetLightAsync(on: boolean): Promise<void>;

    /**
     * Requests that the printer print a file from its storage.
     * @param fileName The name of the file stored on the printer's storage.
     */
    PrintFileAsync(fileName: string, fileSizeBytes?: number): Promise<any>;

    /**
     * Send a file to the printer and stores it in internal storage.
     * Note. If the file name ends with .gx, it will be unmodified, but .gocde will files
     * will be renamed to .g.
     * @param filePath The path of the file to transferer.
     */
    StoreFileAsync(filePath: string): TransferFileStatus;

    /**
     * Uploads a file and starts printing it. Progress is reported through
     * TransferStateChanged so the header banner stays visible on every page.
     */
    UploadAndPrintAsync(filePath: string): Promise<void>;

    /**
     * Invoked when file transfer progress or phase changes.
     */
    TransferStateChanged: EventDispatcher<TransferState>;

    /**
     * Gets the current file transfer state.
     */
    GetTransferState(): TransferState;

    /**
     * Pauses all printer polling (heartbeat and status UI) and waits for any
     * in-flight status requests to finish. Call before a file transfer so that
     * status commands are not sent during the M28/M29 handshake.
     */
    SuspendPollingAsync(): Promise<void>;

    /**
     * Resumes printer polling after a file transfer.
     */
    ResumePolling(): void;

    /**
     * Returns true while polling is suspended for a file transfer.
     */
    IsPollingSuspended(): boolean;

    /**
     * Requests the firmware version info from the printer.
     */
    GetFirmwareVersionAsync(): Promise<FirmwareVersionResponse>;

    /**
     * Requests the temperature info from the printer.
     */
    GetTemperatureAsync(): Promise<TemperatureResponse>;

    /**
     * Gets the printer camera.
     */
    GetCamera(): PrinterCamera;
}

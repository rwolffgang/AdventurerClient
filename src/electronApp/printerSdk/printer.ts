const net = window.require('net');
const fs = window.require('fs');

import { PrinterResponseReader } from './printerResponseReader';
import { GcodeToGx } from './gcodeToGx';
import { CuraToFlashforge } from './curaToFlashforge';
import { PrinterCamera } from './printerCamera'
import { PrinterStatus, FirmwareVersionResponse, TemperatureResponse, IPrinterResponse, TextCommandResponse } from './entities';
import { MachineCommands } from './machineCommands';
import { PromiseWithProgress } from '../core/PromiseWithProgress'
import { ErrorLogger } from 'electronApp/core';

/**
 * Represents the printer.
 */
export class Printer {
    /**
     * The address of the printer.
     */
    readonly printerAddress: string;

    /**
     * Value indicating if the class has been disposed
     */
    private isDisposed: false;

    /**
     * The socket connection to the printer.
     */
    private printerConnection: any;

    /**
     * The printer response reader.
     */
    private responseReader: PrinterResponseReader;

    /**
     * Indicates that we are currently in the connected state.
     */
    private isConnected: boolean;

    /**
     * Gets the printer's camera.
     */
    public PrinterCamera: PrinterCamera;

    /**
     * The number of bytes sent to the printer in each packet.
     *
     * Larger writes mean far fewer write/drain round-trips on the socket, which
     * lets the OS fill full-size TCP segments and noticeably speeds up the bulk
     * transfer. The printer reads the post-M28 stream as raw bytes and counts
     * the total, so the chunk size is purely a local batching choice.
     */
    private readonly packetSizeBytes = 64 * 1024;

    /**
     * Serialises all commands on the single printer socket so nothing can
     * interleave with a file transfer.
     */
    private communicationLock: Promise<void> = Promise.resolve();

    /**
     * Whether this connection already holds printer control from a prior M601.
     * The firmware returns "Control failed." when M601 is sent again on the
     * same connection — that is not a real error.
     */
    private hasPrinterControl = false;

    /**
     * When true, routine status polling traffic is not written to the log file.
     */
    private protocolLoggingSuppressed = false;

    /**
     * If a single chunk cannot be flushed to the printer within this window the
     * printer has stopped draining the socket (a wedged transfer). Back-pressure
     * pacing means a healthy printer drains a 64 KB chunk in a few seconds even
     * on a slow link, so this only fires when the printer has truly stalled —
     * letting us fail fast instead of hanging at "100%".
     */
    private readonly transferStallTimeoutMilliseconds = 30000;

    /**
     * Initializes a new instance of the Printer class.
     * @param ipAddress he IP address of the printer to connect to.
     */
    public constructor(ipAddress: string) {
        this.printerAddress = ipAddress;
        this.PrinterCamera = new PrinterCamera(ipAddress);
    }

    /**
     * Send some data to the printer.
     * @param data The data to send.
     */
    private SendToPrinter(data: string): void {

        data = data + '\n';

        if (!this.protocolLoggingSuppressed) {
            ErrorLogger.LogToPrinter(data);
        }

        this.printerConnection.write(data);
    }

    /**
     * Send a buffer to the printer, respecting TCP back-pressure.
     *
     * The promise resolves once the data has been handed to the OS socket
     * buffer (immediately if there is room, or after the socket drains). This
     * paces a large file transfer to the rate the printer can actually consume.
     * @param data The data to send.
     */
    private SendBufferToPrinter(data: Buffer): Promise<void> {

        ErrorLogger.LogBinaryToPrinter(data.length);

        return new Promise<void>((resolve, reject) => {
            const flushed = this.printerConnection.write(data);
            if (flushed) {
                resolve();
                return;
            }

            const stallTimer = setTimeout(() => {
                this.printerConnection.removeListener('drain', onDrain);
                reject(new Error(
                    'The printer stopped accepting data during the file transfer. '
                    + 'This usually means the file is too large for the printer to take over '
                    + 'the network — copy the .gx to a USB stick and print it from the printer.'));
            }, this.transferStallTimeoutMilliseconds);

            const onDrain = () => {
                clearTimeout(stallTimer);
                resolve();
            };

            this.printerConnection.once('drain', onDrain);
        });
    }

    /**
     * Connect to the printer.
     */
    async ConnectAsync(): Promise<void> {
        return new Promise((a, r) => {
            this.printerConnection = new net.Socket();
            this.printerConnection.on('error', (ex: any) => {
                this.isConnected = false;
                r(ex);
            });

            this.printerConnection.on('close', () => {
                this.isConnected = false;
            });

            this.printerConnection.on('data', data => {
                const text = Buffer.isBuffer(data) ? data.toString('latin1') : String(data);
                if (!this.protocolLoggingSuppressed) {
                    ErrorLogger.LogFromPrinter(text);
                }
            });

            this.printerConnection.connect(8899, this.printerAddress, async () => {
                try {
                    this.printerConnection.setNoDelay(true);
                    this.responseReader = new PrinterResponseReader(this.printerConnection);
                    this.isConnected = true;

                    await this.TakeControlAsync();
                    await this.GetPrinterStatusAsync();
                    a();
                } catch (ex) {
                    this.isConnected = false;
                    r(ex);
                }
            });
        });
    }

    /**
     * Disconnect from the printer.
     */
    Disconnect(): void {
        this.hasPrinterControl = false;
        this.printerConnection.destroy();
        this.PrinterCamera.DisconnectCamera();
    }

    /**
     * Stops the printing.
     */
    StopPrintingAsync(): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.StopPrinting;
            this.SendToPrinter(message);

            return this.WaitForPrinterAck(MachineCommands.StopPrinting);
        });
    }

    /**
     * Pause the printing.
     */
    PausePrintingAsync(): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.PausePrinting;
            this.SendToPrinter(message);

            return this.WaitForPrinterAck(MachineCommands.PausePrinting);
        });
    }

    /**
     * Resume the printing.
     */
    ResumePrintingAsync(): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.ResumePrinting;
            this.SendToPrinter(message);

            return this.WaitForPrinterAck(MachineCommands.ResumePrinting);
        });
    }

    /**
     * Gets the current status of the printer.
     */
    GetPrinterStatusAsync(): Promise<PrinterStatus> {
        return this.RunExclusiveWithSuppressedProtocolLogging(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.GetEndstopStatus;
            this.SendToPrinter(message);

            return this.responseReader.GerPrinterResponse<PrinterStatus>(MachineCommands.GetEndstopStatus);
        });
    }

    /**
     * Gets the firmware version of the printer.
     */
    GetFirmwareVersionAsync(): Promise<FirmwareVersionResponse> {
        return this.RunExclusiveWithSuppressedProtocolLogging(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.GetFirmwareVersion;
            this.SendToPrinter(message);

            return this.responseReader.GerPrinterResponse<FirmwareVersionResponse>(MachineCommands.GetFirmwareVersion);
        });
    }

    /**
     * Gets the printer temperature.
     */
    GetTemperatureAsync(): Promise<TemperatureResponse> {
        return this.RunExclusiveWithSuppressedProtocolLogging(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.GetTemperature;
            this.SendToPrinter(message);

            return this.responseReader.GerPrinterResponse<TemperatureResponse>(MachineCommands.GetTemperature);
        });
    }

    /**
     * Sends a command to the printer and returns the response text lines.
     * @param command The full command and any parameters to send to the printer.
     */
    SendDebugCommandAsync(command: string): Promise<string[]> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            const commandId = Printer.ExtractCommandId(command);
            const responsePromise = this.responseReader.GerPrinterResponse<IPrinterResponse>(commandId);
            this.SendToPrinter('~' + command);

            const response = await Promise.race([
                responsePromise,
                new Promise<never>((_, reject) => {
                    setTimeout(
                        () => reject(new Error('Timed out waiting for ' + commandId + ' response')),
                        60000);
                })
            ]);

            return Printer.FormatDebugCommandResponse(response);
        });
    }

    /**
     * Reads the command identifier from a user-entered command string.
     */
    private static ExtractCommandId(command: string): string {
        const match = command.trim().match(/^([MG]\d+)/i);

        if (match == null) {
            throw new Error('Command must start with an M-code or G-code such as M503');
        }

        return match[1].toUpperCase();
    }

    /**
     * Formats a printer response for display in the debug command log.
     */
    private static FormatDebugCommandResponse(response: IPrinterResponse | null): string[] {
        if (response instanceof TextCommandResponse) {
            return response.Lines;
        }

        if (response instanceof FirmwareVersionResponse) {
            return [
                'Machine Type: ' + response.MachineType,
                'Machine Name: ' + response.MachineName,
                'Firmware: ' + response.FirmwareVersion,
                'Serial: ' + response.SerialNumber,
                'Build volume: '
                    + response.BuildVolume.X + ' × '
                    + response.BuildVolume.Y + ' × '
                    + response.BuildVolume.Z,
            ];
        }

        if (response instanceof PrinterStatus) {
            const lines = [
                'MachineStatus: ' + (response.MachineStatus ?? '—'),
                'MoveMode: ' + (response.MoveMode ?? '—'),
            ];

            if (response.LightOn != null) {
                lines.push('Light: ' + (response.LightOn ? 'on' : 'off'));
            }

            return lines;
        }

        if (response instanceof TemperatureResponse) {
            return [
                'Nozzle: ' + (response.Tool0Temp ?? 0) + '°C / ' + (response.Tool0TargetTemp ?? 0) + '°C',
                'Bed: ' + (response.BuildPlateTemp ?? 0) + '°C / ' + (response.BuildPlateTargetTemp ?? 0) + '°C',
            ];
        }

        if (response == null) {
            return ['ok'];
        }

        return [];
    }

    /**
     * Turns the enclosure light on or off.
     */
    SetLightAsync(on: boolean): Promise<void> {
        const parameters = on ? ' r255 g255 b255 F0' : ' r0 g0 b0 F0';

        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            const message = '~' + MachineCommands.SetLight + parameters;
            this.SendToPrinter(message);

            return this.WaitForPrinterAck(MachineCommands.SetLight);
        });
    }

    /**
     * Instructs the printer to print a file already stored in its internal storage.
     * @param fileName The file name (including extension) of the file to print.
     */
    PrintFileAsync(fileName: string, fileSizeBytes?: number): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();

            if (fileSizeBytes != null && fileSizeBytes > 0) {
                const postSaveDelayMilliseconds = this.ComputePostSaveSettleDelayMilliseconds(fileSizeBytes);
                ErrorLogger.Trace(
                    'Waiting '
                    + postSaveDelayMilliseconds
                    + 'ms for SD card to settle before M23');
                await this.Delay(postSaveDelayMilliseconds);
            }

            const message = '~' + MachineCommands.PrintFileFromSd + ' 0:/user/' + fileName;
            const responsePromise = this.responseReader.GerPrinterResponse<TextCommandResponse>(
                MachineCommands.PrintFileFromSd);
            this.SendToPrinter(message);

            const response = await Promise.race([
                responsePromise,
                new Promise<never>((_, reject) => {
                    setTimeout(
                        () => reject(new Error('Timed out waiting for M23 acknowledgement')),
                        120000);
                })
            ]);

            this.ValidatePrintFileOpened(response, fileName);
        });
    }

    /**
     * Takes exclusive control of the printer (v2.x firmware).
     */
    TakeControlAsync(): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();
            await this.TakeControlAsyncInternal();
        });
    }

    /**
     * Transfers a file to the printer's storage with a given name.
     * @param filePath The path to the file to transfer.
     * @param fileName The name of the file to store it as (without file extension)
     */
    StoreFileAsync(filePath: string, fileName: string): PromiseWithProgress<void> {
        return new PromiseWithProgress<void>((updateProgress: (value: number) => void) => {
            return this.StoreFileAsyncInternal(filePath, fileName, updateProgress);
        });
    }

    /**
     * Transfers a file to the printer's storage with a given name.
     * @param filePath The path to the file to transfer.
     * @param fileName The name of the file to store it as (without file extension)
     * @param updateProgress The function to cal with progress updates
     */
    private async StoreFileAsyncInternal(filePath: string, fileName: string, updateProgress: (number: number) => void): Promise<void> {
        return this.RunExclusive(async () => {
            this.ValidatePrinterReady();

            let modelBytes = await new Promise<Buffer>((a, r) => {
                fs.readFile(filePath, (error: any, data: any) => {
                    if (error) {
                        r(error);
                        return;
                    }

                    a(data);
                });
            });

            if (!GcodeToGx.IsGxFormat(modelBytes)) {
                const gcodeText = modelBytes.toString('latin1');
                if (CuraToFlashforge.NeedsConversion(gcodeText)) {
                    const fixed = CuraToFlashforge.Convert(gcodeText);
                    ErrorLogger.Trace(
                        'Applied Cura->FlashForge fixes: '
                        + fixed.stats.zSplits + ' Z-splits, '
                        + fixed.stats.g0ToG1 + ' G0->G1, '
                        + fixed.stats.fMovedToEnd + ' F-moved-to-end, '
                        + fixed.stats.tempsDeDecimalised + ' temps de-decimalised');
                    modelBytes = Buffer.from(fixed.text, 'latin1');
                }

                ErrorLogger.Trace("Wrapping plain gcode into .gx format");
                modelBytes = GcodeToGx.Convert(modelBytes);
            }

            this.PrinterCamera.PauseCamera();
            try {
                ErrorLogger.Trace("Starting file transfer");
                let message = '~' + MachineCommands.BeginWriteToSdCard + ' ' + modelBytes.length + ' 0:/user/' + fileName;
                await this.SendCommandAndWaitForAck(message, MachineCommands.BeginWriteToSdCard);

                for (let offset = 0; offset < modelBytes.length; offset += this.packetSizeBytes) {
                    const chunk = modelBytes.subarray(offset, Math.min(offset + this.packetSizeBytes, modelBytes.length));
                    await this.SendBufferToPrinter(chunk);
                    updateProgress(offset / modelBytes.length);
                }
                updateProgress(1);

                const endTransferSettleDelayMilliseconds =
                    this.ComputeEndTransferSettleDelayMilliseconds(modelBytes.length);
                ErrorLogger.Trace(
                    'Waiting '
                    + endTransferSettleDelayMilliseconds
                    + 'ms after last file byte before M29');
                await this.Delay(endTransferSettleDelayMilliseconds);

                ErrorLogger.Trace("Ending file transfer (M29)");
                message = '~' + MachineCommands.EndWriteToSdCard;
                const m29TimeoutMilliseconds = this.ComputeM29TimeoutMilliseconds(modelBytes.length);
                try {
                    await this.SendCommandAndWaitForAck(
                        message,
                        MachineCommands.EndWriteToSdCard,
                        m29TimeoutMilliseconds);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    if (reason.includes('Timed out')) {
                        throw new Error(
                            'The printer never confirmed it saved the file. For large files this '
                            + 'often means it cannot take them over the network — copy the .gx to a '
                            + 'USB stick and print it from the printer instead.');
                    }
                    throw error;
                }
                ErrorLogger.Trace("File transfer complete (M29 acknowledged)");
            } finally {
                this.PrinterCamera.ResumeCamera();
            }
        });
    }

    /**
     * Takes exclusive control without re-entering the communication lock.
     * Skips M601 when this connection already holds control — the firmware
     * answers "Control failed." to a duplicate M601 on the same socket.
     */
    private async TakeControlAsyncInternal(): Promise<void> {
        if (this.hasPrinterControl) {
            ErrorLogger.Trace('Printer control already held on this connection, skipping M601');
            return;
        }

        try {
            await this.SendTakeControlCommandAsync();
            this.hasPrinterControl = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('Printer control failed')) {
                throw error;
            }

            ErrorLogger.Trace('M601 rejected, releasing and retrying once');
            try {
                await this.SendCommandAndWaitForAck(
                    '~' + MachineCommands.ReleaseControl,
                    MachineCommands.ReleaseControl,
                    10000);
            } catch {
                // We may not have had control to release.
            }
            this.hasPrinterControl = false;

            await this.SendTakeControlCommandAsync();
            this.hasPrinterControl = true;
        }
    }

    private async SendTakeControlCommandAsync(): Promise<void> {
        await this.SendCommandAndWaitForAck(
            '~' + MachineCommands.TakeControl + ' S1',
            MachineCommands.TakeControl);
    }

    /**
     * Registers for a response before sending so a fast printer reply cannot
     * arrive before the pending-call listener is attached.
     */
    private async SendCommandAndWaitForAck(
        command: string,
        commandId: string,
        timeoutMilliseconds: number = 60000): Promise<void> {
        const responsePromise = this.responseReader.GerPrinterResponse<IPrinterResponse>(commandId);
        this.SendToPrinter(command);
        await Promise.race([
            responsePromise,
            new Promise<void>((_, reject) => {
                setTimeout(
                    () => reject(new Error('Timed out waiting for ' + commandId + ' acknowledgement')),
                    timeoutMilliseconds);
            })
        ]);
    }

    private Delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    /**
     * Extra time after the last byte before M29 so the printer can drain its
     * TCP receive buffer and finish writing to SD before leaving binary mode.
     */
    private ComputeEndTransferSettleDelayMilliseconds(fileSizeBytes: number): number {
        const sizeMegabytes = fileSizeBytes / (1024 * 1024);
        return Math.min(30000, 500 + Math.ceil(sizeMegabytes * 1000));
    }

    /**
     * Time to wait after M29 before M23 so the saved file is visible on SD.
     */
    private ComputePostSaveSettleDelayMilliseconds(fileSizeBytes: number): number {
        const sizeMegabytes = fileSizeBytes / (1024 * 1024);
        return Math.min(15000, 1000 + Math.ceil(sizeMegabytes * 500));
    }

    /**
     * M29 save time grows with file size on real hardware.
     */
    private ComputeM29TimeoutMilliseconds(fileSizeBytes: number): number {
        const sizeMegabytes = fileSizeBytes / (1024 * 1024);
        return Math.min(240000, 60000 + Math.ceil(sizeMegabytes * 30000));
    }

    /**
     * Ensures M23 opened a non-empty file before treating the print as started.
     */
    private ValidatePrintFileOpened(response: TextCommandResponse | IPrinterResponse | null, fileName: string): void {
        if (!(response instanceof TextCommandResponse)) {
            return;
        }

        const sizeLine = response.Lines.find(line => line.includes('Size:'));
        const sizeMatch = sizeLine?.match(/Size:\s*(\d+)/);

        if (sizeMatch == null) {
            return;
        }

        const reportedSize = parseInt(sizeMatch[1], 10);
        if (reportedSize === 0) {
            throw new Error(
                'The printer reported file size 0 when opening "'
                + fileName
                + '" to print, so the upload was not saved correctly. For large files this often '
                + 'means the printer cannot accept them over the network — copy the .gx to a USB '
                + 'stick and print it from the printer instead.');
        }
    }

    /**
     * Runs a routine status poll without writing command/response traffic to the log.
     */
    private async RunExclusiveWithSuppressedProtocolLogging<T>(operation: () => Promise<T>): Promise<T> {
        return this.RunExclusive(async () => {
            this.protocolLoggingSuppressed = true;
            try {
                return await operation();
            } finally {
                this.protocolLoggingSuppressed = false;
            }
        });
    }

    /**
     * Runs an operation while holding the exclusive printer socket lock.
     */
    private async RunExclusive<T>(operation: () => Promise<T>): Promise<T> {
        const previousLock = this.communicationLock;
        let releaseCurrent: () => void;
        this.communicationLock = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
        });
        await previousLock;

        try {
            return await operation();
        } finally {
            releaseCurrent();
        }
    }

    /**
     * Waits fot the printer to acknowledge that a command send to it completed.
     */
    private async WaitForPrinterAck(commandId: string, timeoutMilliseconds: number = 60000): Promise<void> {
        await Promise.race([
            this.responseReader.GerPrinterResponse<IPrinterResponse>(commandId),
            new Promise<void>((_, reject) => {
                setTimeout(
                    () => reject(new Error('Timed out waiting for ' + commandId + ' acknowledgement')),
                    timeoutMilliseconds);
            })
        ]);
    }

    /**
     * Validates that we are currently in a valid state to communicate with the printer.
     */
    private ValidatePrinterReady(): void {
        if (this.isDisposed) {
            throw new Error('Printer is no longer connected');
        }
        if (!this.isConnected) {
            throw new Error(('Not connected to printer, or connection lost'));
        }
    }
}

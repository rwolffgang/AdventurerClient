import { MachineCommands } from './machineCommands';
import { ErrorLogger } from '../core/errorLogger';

/**
 * Raised when the printer doesn't answer a command in time.
 */
export class PrinterTimeoutError extends Error {
    constructor(commandId: string) {
        super('Timed out waiting for the printer to answer ' + commandId);
        this.name = 'PrinterTimeoutError';
    }
}
import { IPrinterResponse, PrinterStatus, TemperatureResponse, FirmwareVersionResponse, TextCommandResponse, PendingCall, PendingResponse } from './entities';

/**
 * A class for reading responses from the printer.
 */
export class PrinterResponseReader
{
    /**
     * The regex for detecting the start of a response and extracting the command.
     */
    private readonly cmdReceivedRegex = new RegExp('CMD (?<CommandId>[MG][0-9]+) Received\.');

    /**
     * The buffer of packets sent from the printer.
     */
    private buffer = '';

    /**
     * The buffer of full lines sent by the printer.
     */
    private readonly lineBuffer: Array<string>  = new Array<string>();

    /**
     * The buffer of command responses send by the printer.
     */
    private readonly responseBuffer: Array<PendingResponse>  = new Array<PendingResponse>();

    /**
     * All requests made to the printer awaiting a response.
     */
    private readonly pendingCalls: Array<PendingCall<IPrinterResponse>> = new Array<PendingCall<IPrinterResponse>>();

    /*
    * The printer connection.
     */
    private socket: any;

    /**
     * Initializes a new instance of the PrinterResponseReader class.
     */
    constructor(socket: object) {
        this.socket = socket;
        this.socket.on('data', (d: any) => this.HandleData(
            Buffer.isBuffer(d) ? d.toString('latin1') : String(d)) );
    }

    /**
     * Handle new data from the printer.
     * @param data The data.
     */
    private HandleData(data: string): void {
        let prev = 0;
        let next = 0;

        while ((next = data.indexOf('\n', prev)) > -1) {
            this.buffer += data.substring(prev, next);

            // Found a new line
            this.lineBuffer.push(this.buffer);
            this.TryDrainBuffer();

            this.buffer = '';
            prev = next + 1;
          }

          // No new line is this data, add to the buffer and for a future packet
        this.buffer += data.substring(prev);
    }

    /**
     * Tries to resolve all received lines into a single response object.
     */
    private TryDrainBuffer(): void {
        const mostResentLine = this.lineBuffer[this.lineBuffer.length - 1].trim();
        if (mostResentLine === 'ok' || mostResentLine === 'ok.') {

            // Find a machine command
            let commandId = this.GetCommandId();

            if (commandId == null && this.pendingCalls.length === 1) {
                commandId = this.pendingCalls[0].CommandId;
            }

            if (commandId != null && commandId.length > 0){
                const controlError = this.GetControlError(commandId, this.lineBuffer);
                if (controlError != null) {
                    this.responseBuffer.push(new PendingResponse(commandId, null, controlError));
                } else {
                    this.responseBuffer.push(new PendingResponse(commandId, this.GenerateResponse(commandId, this.lineBuffer)));
                }

                this.TryDrainPendingCalls();
            }

            this.lineBuffer.length = 0;
        }
        else if (mostResentLine.endsWith('error')) {

            // Find a machine command
            const commandId = this.GetCommandId();

            // Pull out the error code
            let errorCode = '';
            const errorParts = mostResentLine.split(' ');

            if (errorParts.length === 2)
            {
                errorCode = errorParts[0];
            }

            if (commandId != null && commandId.length > 0){
                // Failed to find a command, the buffer is useless.
                this.responseBuffer.push(new PendingResponse(commandId, null, new Error(errorCode)));

                this.TryDrainPendingCalls();
            }

            this.lineBuffer.length = 0;
        }
    }

    /**
     * Gets the command ID that a given response is for.
     */
    private GetCommandId(): string {
        for (let i = this.lineBuffer.length - 2; i >= 0; --i) {
            const searchLine = this.lineBuffer[i];

            if (searchLine.includes('Done saving file')) {
                return MachineCommands.EndWriteToSdCard;
            }

            const match = searchLine.match(this.cmdReceivedRegex);
            if (this.cmdReceivedRegex.test(searchLine)) {

                // Pull out the ID that the response is for
                return match.groups['CommandId'];
            }
        }

        return null;
    }

    /**
     * Returns an error when M601/M602 indicates the printer rejected control.
     */
    private GetControlError(commandId: string, lines: Array<string>): Error | null {
        if (commandId !== MachineCommands.TakeControl) {
            return null;
        }

        for (const line of lines) {
            if (line.includes('Control Success')) {
                return null;
            }
        }

        for (const line of lines) {
            if (line.includes('Control failed')) {
                return new Error(
                    'Printer control failed. Close FlashPrint or any other app using the printer, then try again.');
            }
        }

        return null;
    }

    private TryDrainPendingCalls(): void {
        for (let i = 0; i < this.responseBuffer.length; ++i){
            for (let a = 0; a < this.pendingCalls.length; ++a){
                const response = this.responseBuffer[i];
                const pendingCall = this.pendingCalls[a];

                if (response.CommandId == pendingCall.CommandId){
                    if (response.Error != null){
                        pendingCall.Reject(response.Error);
                    }
                    else {
                        pendingCall.Accept(response.Result);
                    }

                    this.responseBuffer.splice(i, 1);
                    this.pendingCalls.splice(a, 1);

                    return;
                }
            }
        }
    }

    /**
     * Waits for the printer's response to a command. Call it before sending the
     * command so a fast reply can't arrive before anyone is listening.
     *
     * A reply already buffered for the same command belongs to an earlier call
     * that gave up waiting, so it is thrown away instead of being handed to this
     * one. When the timeout expires the call is removed from the queue, so a late
     * reply can't be matched to it either.
     * @param commandId The command to wait for, for example M119.
     * @param timeoutMilliseconds How long to wait before failing.
     */
    public GetPrinterResponse<T extends IPrinterResponse>(commandId: string, timeoutMilliseconds: number): Promise<T> {
        this.DiscardStaleResponses(commandId);

        return new Promise<T>((accept, reject) => {
            let timer: ReturnType<typeof setTimeout>;

            const pendingCall = new PendingCall<T>(
                commandId,
                (response: T) => {
                    clearTimeout(timer);
                    accept(response);
                },
                (error: Error) => {
                    clearTimeout(timer);
                    reject(error);
                });

            timer = setTimeout(() => {
                const index = this.pendingCalls.indexOf(pendingCall);
                if (index !== -1) {
                    this.pendingCalls.splice(index, 1);
                }

                reject(new PrinterTimeoutError(commandId));
            }, timeoutMilliseconds);

            this.pendingCalls.push(pendingCall);
            this.TryDrainPendingCalls();
        });
    }

    /**
     * Fails every call still waiting for a reply, for example because the
     * connection to the printer was lost.
     * @param error The error to fail the waiting calls with.
     */
    public RejectAll(error: Error): void {
        const pendingCalls = this.pendingCalls.splice(0);
        this.responseBuffer.length = 0;
        this.lineBuffer.length = 0;
        this.buffer = '';

        pendingCalls.forEach(pendingCall => pendingCall.Reject(error));
    }

    /**
     * Drops buffered replies to a command that nobody is waiting for any more.
     */
    private DiscardStaleResponses(commandId: string): void {
        for (let i = this.responseBuffer.length - 1; i >= 0; --i) {
            if (this.responseBuffer[i].CommandId === commandId) {
                ErrorLogger.Trace('Discarding a late ' + commandId + ' reply from an earlier request');
                this.responseBuffer.splice(i, 1);
            }
        }
    }

    /**
     * Generates a response object from returned data.
     * @param command The command that the response is for.
     * @param data The data in the response.
     */
    private GenerateResponse(command: string, data: Array<string>): IPrinterResponse
    {
        switch (command)
        {
            case MachineCommands.GetEndstopStatus:
                return new PrinterStatus(data);
            case MachineCommands.GetFirmwareVersion:
                return new FirmwareVersionResponse(data);
            case MachineCommands.GetTemperature:
                return new TemperatureResponse(data);
            case MachineCommands.BeginWriteToSdCard:
            case MachineCommands.EndWriteToSdCard:
            case MachineCommands.StopPrinting:
            case MachineCommands.PausePrinting:
            case MachineCommands.ResumePrinting:
            case MachineCommands.TakeControl:
            case MachineCommands.ReleaseControl:
            case MachineCommands.SetLight:
                return null;
            case MachineCommands.PrintFileFromSd:
                return new TextCommandResponse(data);
            default:
                return new TextCommandResponse(data);
        }
    }
}

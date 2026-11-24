const fs = window.require('fs');
const path = window.require('path');
const os = window.require('os');

const maxLogSizeBytes = 10 * 1024 * 1024;
const logRetentionDays = 7;
const logFileName = 'adventurer-client.log';
const repeatedErrorSummaryIntervalMilliseconds = 60 * 1000;
const cameraConnectionErrorPattern = /connect E[A-Z]+ .+:8080/i;

/**
 * A static class for logging errors and printer protocol traffic to a file.
 */
export class ErrorLogger {
    private static logFilePath: string | null = null;
    private static lastNonFatalErrorKey: string | null = null;
    private static lastNonFatalErrorTime = 0;
    private static suppressedNonFatalErrorCount = 0;
    private static cameraConnectionErrorLogged = false;

    /**
     * Log an error that the app recovered from.
     * Repeated identical errors are summarized instead of logged every time.
     * @param error The error.
     */
    public static NonFatalError(error: Error): void {
        if (ErrorLogger.ShouldIgnoreError(error)) {
            return;
        }

        const errorKey = error.toString();
        const now = Date.now();

        if (
            errorKey === ErrorLogger.lastNonFatalErrorKey
            && now - ErrorLogger.lastNonFatalErrorTime < repeatedErrorSummaryIntervalMilliseconds
        ) {
            ErrorLogger.suppressedNonFatalErrorCount++;
            return;
        }

        if (ErrorLogger.suppressedNonFatalErrorCount > 0) {
            ErrorLogger.WriteLine(
                'ErrorLogger::NonFatalError() - Previous error repeated '
                + ErrorLogger.suppressedNonFatalErrorCount
                + ' more time(s) within '
                + (repeatedErrorSummaryIntervalMilliseconds / 1000)
                + ' seconds.');
            ErrorLogger.suppressedNonFatalErrorCount = 0;
        }

        ErrorLogger.lastNonFatalErrorKey = errorKey;
        ErrorLogger.lastNonFatalErrorTime = now;

        const errorMessage =
            'ErrorLogger::NonFatalError() - '
            + error.toString()
            + '\n'
            + error.stack;

        ErrorLogger.WriteLine(errorMessage);
    }

    /**
     * Logs a diagnostic message, such as the steps of a file upload. Routine
     * status polling is never traced, so this stays small.
     * @param message The message.
     */
    public static Trace(message: string): void {
        const formattedMessage =
            'ErrorLogger::Trace() - '
            + message;

        ErrorLogger.WriteLine(formattedMessage);
    }

    /**
     * Logs a command or text line sent to the printer.
     * @param message The message sent to the printer.
     */
    public static LogToPrinter(message: string): void {
        ErrorLogger.WriteLine('>> ' + message.trim());
    }

    /**
     * Logs raw file bytes sent to the printer during an upload.
     * @param byteCount The number of bytes sent.
     */
    public static LogBinaryToPrinter(byteCount: number): void {
        ErrorLogger.WriteLine('>> [file data: ' + byteCount + ' bytes]');
    }

    /**
     * Logs data received from the printer.
     * @param message The data received from the printer.
     */
    public static LogFromPrinter(message: string): void {
        const trimmedMessage = message.trim();
        if (trimmedMessage.length === 0) {
            return;
        }

        ErrorLogger.WriteLine('<< ' + trimmedMessage);
    }

    /**
     * Returns the path to the active log file.
     */
    public static GetLogFilePath(): string {
        if (ErrorLogger.logFilePath == null) {
            ErrorLogger.logFilePath = ErrorLogger.ResolveLogFilePath();
        }

        return ErrorLogger.logFilePath;
    }

    /**
     * Sets up the logger and purges old logs.
     */
    public static SetUp(): void {
        ErrorLogger.DeleteOldLogs();
        ErrorLogger.WriteLine(
            'ErrorLogger::SetUp() - Application started. Log file: '
            + ErrorLogger.GetLogFilePath());
    }

    private static ShouldIgnoreError(error: Error): boolean {
        const message = error.toString();

        if (cameraConnectionErrorPattern.test(message)) {
            if (!ErrorLogger.cameraConnectionErrorLogged) {
                ErrorLogger.cameraConnectionErrorLogged = true;
                ErrorLogger.WriteLine(
                    'ErrorLogger::NonFatalError() - Camera stream unavailable on port 8080. '
                    + 'Further camera connection errors will not be logged.');
            }

            return true;
        }

        return false;
    }

    private static ResolveLogFilePath(): string {
        let logsDirectory: string;

        try {
            const electron = window.require('electron');
            logsDirectory = path.join(electron.remote.app.getPath('userData'), 'logs');
        } catch {
            if (process.platform === 'win32') {
                logsDirectory = path.join(
                    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
                    'adventurerclient',
                    'logs');
            } else if (process.platform === 'darwin') {
                logsDirectory = path.join(os.homedir(), 'Library', 'Logs', 'adventurer-client');
            } else {
                logsDirectory = path.join(os.homedir(), '.config', 'adventurer-client', 'logs');
            }
        }

        fs.mkdirSync(logsDirectory, { recursive: true });
        return path.join(logsDirectory, logFileName);
    }

    private static WriteLine(message: string): void {
        try {
            const filePath = ErrorLogger.GetLogFilePath();
            ErrorLogger.RotateLogIfNeeded(filePath);

            const timestamp = ErrorLogger.FormatTimestamp(new Date());
            fs.appendFileSync(filePath, timestamp + ' ' + message + os.EOL);
        } catch {
            // Logging must not break the app.
        }
    }

    private static FormatTimestamp(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
    }

    private static RotateLogIfNeeded(filePath: string): void {
        try {
            const stat = fs.statSync(filePath);
            if (stat.size > maxLogSizeBytes) {
                const rotatedPath = filePath.replace(/\.log$/, '.old.log');
                fs.renameSync(filePath, rotatedPath);
            }
        } catch {
            // File does not exist yet, or rotation failed.
        }
    }

    private static DeleteOldLogs(): void {
        try {
            const logsDirectory = path.dirname(ErrorLogger.GetLogFilePath());
            const cutoffTime = Date.now() - (logRetentionDays * 24 * 60 * 60 * 1000);

            for (const fileName of fs.readdirSync(logsDirectory)) {
                if (!fileName.endsWith('.log')) {
                    continue;
                }

                const filePath = path.join(logsDirectory, fileName);
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs < cutoffTime) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch {
            // Old log cleanup is best-effort.
        }
    }
}

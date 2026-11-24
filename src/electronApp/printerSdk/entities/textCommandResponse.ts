import { IPrinterResponse } from './iPrinterResponse';

/**
 * Raw text lines returned by an arbitrary G-code or M-code command.
 */
export class TextCommandResponse implements IPrinterResponse {
    /**
     * Response lines with protocol noise removed.
     */
    public readonly Lines: string[];

    /**
     * Initializes a new instance of the TextCommandResponse class.
     */
    constructor(lines: string[]) {
        this.Lines = TextCommandResponse.FilterResponseLines(lines);
    }

    /**
     * Removes command framing lines from a printer response.
     */
    private static FilterResponseLines(lines: string[]): string[] {
        return lines
            .map(line => line.trim())
            .filter(line => {
                if (line.length === 0) {
                    return false;
                }

                if (line === 'ok' || line === 'ok.') {
                    return false;
                }

                if (/^CMD [MG]\d+ Received\.$/i.test(line)) {
                    return false;
                }

                return true;
            });
    }
}

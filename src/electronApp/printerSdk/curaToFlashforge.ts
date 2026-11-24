/**
 * Post-processes Ultimaker Cura G-code so it prints correctly on the
 * FlashForge Adventurer 3 (also Monoprice Voxel and other MakerBot-derived
 * FlashForge firmware).
 *
 * The Adventurer 3 firmware understands only a subset of Marlin G-code. Cura's
 * output is fine for simple shapes, but once supports/skin make the move stream
 * complex the printer can stop indexing Z entirely - every layer prints at the
 * same height. The documented firmware quirks behind this:
 *
 *   - Combined XYZ in a single move is mishandled -> split Z onto its own line
 *   - Travel must be G1, not G0 (FlashPrint never emits G0)
 *   - The F (feed-rate) parameter must be LAST on the line, not first
 *   - M104/M140 temperatures must be integers (S210, not S210.0)
 *
 * Only the PRINT BODY (between ';End Start' and ';end gcode') is rewritten; the
 * FlashForge-native start/end blocks are left untouched. Running it on gcode
 * that lacks those markers, or on already-converted gcode, is a safe no-op.
 *
 * Ported to TypeScript from a Python post-processing script (cura_to_flashforge.py).
 */

/**
 * Counts of each transform applied, for diagnostics/logging.
 */
export interface CuraFixStats {
    zSplits: number;
    g0ToG1: number;
    fMovedToEnd: number;
    tempsDeDecimalised: number;
}

export class CuraToFlashforge {
    /** Split a combined Z+XY travel into a Z-move then an XY-move. */
    private static readonly SplitZ = true;
    /** Convert travel G0 -> G1. */
    private static readonly G0ToG1 = true;
    /** Move/append the F parameter to the end of every move line. */
    private static readonly FToEnd = true;
    /** Strip decimals from M104/M109/M140/M190 temperatures. */
    private static readonly MNoDecimal = true;

    /** Body is everything strictly between these two markers (case-insensitive). */
    private static readonly BodyStartMarker = ';end start';
    private static readonly BodyEndMarker = ';end gcode';

    private static readonly MoveRegex = /^(G[01])\b(.*)$/;
    private static readonly TempRegex = /^(M(?:104|109|140|190)\b.*?)S(-?\d+\.\d+)(.*)$/;

    /**
     * Returns true if the text contains the print-body markers this converter
     * keys off, i.e. it looks like Cura output with a FlashForge start block.
     */
    public static NeedsConversion(text: string): boolean {
        const lower = text.toLowerCase();
        return lower.includes(CuraToFlashforge.BodyStartMarker)
            && lower.includes(CuraToFlashforge.BodyEndMarker);
    }

    /**
     * Rewrites the print body of Cura gcode for the Adventurer 3 firmware.
     */
    public static Convert(text: string): { text: string; stats: CuraFixStats } {
        const out: string[] = [];
        let inBody = false;
        let lastF: string | null = null;
        const stats: CuraFixStats = { zSplits: 0, g0ToG1: 0, fMovedToEnd: 0, tempsDeDecimalised: 0 };

        const lines = text.split(/\r?\n/);
        // text.splitlines() in Python does not yield a trailing empty element
        // for a final newline; mirror that so the re-join matches byte-for-byte.
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        for (const raw of lines) {
            let line = raw;
            const low = line.trim().toLowerCase();

            if (!inBody) {
                if (low === CuraToFlashforge.BodyStartMarker) {
                    inBody = true;
                }
                out.push(line);
                continue;
            }

            if (low === CuraToFlashforge.BodyEndMarker) {
                inBody = false;
                out.push(line);
                continue;
            }

            if (CuraToFlashforge.MNoDecimal) {
                const fixed = CuraToFlashforge.FixTemp(line);
                if (fixed !== line) {
                    stats.tempsDeDecimalised++;
                    line = fixed;
                }
            }

            const [code, comment] = CuraToFlashforge.SplitLine(line);
            const move = CuraToFlashforge.MoveRegex.exec(code.trim());
            if (move == null) {
                out.push(line);
                continue;
            }

            const gcode = move[1];
            const params = CuraToFlashforge.ParseParams(move[2]);
            const hadFFirst = move[2].trimStart().toUpperCase().startsWith('F');
            const wasG0 = gcode === 'G0';

            const built = CuraToFlashforge.BuildMove(gcode, params, comment.trim(), lastF);
            lastF = built.lastF;

            if (CuraToFlashforge.G0ToG1 && wasG0) {
                stats.g0ToG1++;
            }
            if (CuraToFlashforge.FToEnd && hadFFirst) {
                stats.fMovedToEnd++;
            }
            if (built.lines.length > 1) {
                stats.zSplits++;
            }

            for (const built_line of built.lines) {
                out.push(built_line);
            }
        }

        return { text: out.join('\n') + '\n', stats };
    }

    /** Returns [codePart, commentPart] where commentPart includes the ';'. */
    private static SplitLine(line: string): [string, string] {
        const idx = line.indexOf(';');
        if (idx === -1) {
            return [line, ''];
        }
        return [line.slice(0, idx), line.slice(idx)];
    }

    /** Parse 'X1 Y2 Z3 E4 F5' -> ordered list of [letter, valueStr]. */
    private static ParseParams(codeRest: string): Array<[string, string]> {
        const result: Array<[string, string]> = [];
        const re = /([A-Za-z])(-?\d*\.?\d+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(codeRest)) !== null) {
            result.push([m[1].toUpperCase(), m[2]]);
        }
        return result;
    }

    /**
     * Assemble one or more move lines from a parsed move, applying G0->G1,
     * Z-split and F-to-end. Returns the new lines and the carried feed-rate.
     */
    private static BuildMove(
        gcode: string,
        params: Array<[string, string]>,
        comment: string,
        lastF: string | null): { lines: string[]; lastF: string | null } {

        const pdict: { [letter: string]: string } = {};
        const order: string[] = [];
        for (const [letter, val] of params) {
            if (!(letter in pdict)) {
                order.push(letter);
            }
            pdict[letter] = val;
        }

        if ('F' in pdict) {
            lastF = pdict['F'];
        }
        const fVal = 'F' in pdict ? pdict['F'] : lastF;

        if (CuraToFlashforge.G0ToG1) {
            gcode = 'G1';
        }

        const hasZ = 'Z' in pdict;
        const hasXy = 'X' in pdict || 'Y' in pdict;
        const hasE = 'E' in pdict;
        // Only split TRAVEL moves (no extrusion). Splitting an extruding move
        // would turn a diagonal bead into an L-shape, so we never touch those.
        const doSplit = CuraToFlashforge.SplitZ && hasZ && hasXy && !hasE;

        const emit = (letters: string[]): string => {
            const parts = [gcode];
            for (const letter of letters) {
                if (letter === 'F') {
                    continue;
                }
                if (letter in pdict) {
                    parts.push(letter + pdict[letter]);
                }
            }
            if (CuraToFlashforge.FToEnd && fVal != null) {
                parts.push('F' + fVal);
            }
            return parts.join(' ');
        };

        const lines: string[] = [];
        if (doSplit) {
            // Z first (lift), then the XY(+anything else) move - safe travel order.
            lines.push(emit(['Z']));
            const rest = order.filter(letter => letter !== 'Z' && letter !== 'F');
            lines.push(emit(rest));
        } else if (CuraToFlashforge.FToEnd) {
            const ordered = order.filter(letter => letter !== 'F');
            lines.push(emit(ordered));
        } else {
            const parts = [gcode];
            for (const letter of order) {
                parts.push(letter + pdict[letter]);
            }
            lines.push(parts.join(' '));
        }

        if (comment) {
            const last = lines[lines.length - 1];
            lines[lines.length - 1] = last ? last + ' ' + comment : comment;
        }

        return { lines, lastF };
    }

    /** Round M104/M109/M140/M190 temperatures to an integer S value. */
    private static FixTemp(line: string): string {
        const m = CuraToFlashforge.TempRegex.exec(line);
        if (m == null) {
            return line;
        }
        return m[1] + 'S' + Math.round(parseFloat(m[2])) + m[3];
    }
}

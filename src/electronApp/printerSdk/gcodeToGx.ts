/**
 * Converts plain gcode (e.g. Cura output) into FlashForge .gx format.
 *
 * The Adventurer III Pro accepts plain gcode, but only acknowledges the M29
 * "saved" command quickly for .gx files - which carry a precomputed print-time
 * estimate and a thumbnail in their header. Plain gcode makes the printer parse
 * the whole file at M29 (90s+ with no acknowledgement), which hangs the upload.
 * Wrapping gcode in a .gx header makes uploads acknowledge fast and shows a
 * thumbnail + time estimate on the printer.
 *
 * .gx layout (little-endian):
 *   0x00  char[16]  "xgcode 1.0\n" + NUL padding
 *   0x10  u32       bitmap offset            (= 58)
 *   0x14  u32       gcode offset (tool 0)    (= 58 + bmpSize)
 *   0x18  u32       gcode offset (tool 1)    (= same)
 *   0x1c  u32       print time, seconds
 *   0x20  u32       filament used, tool 0 (cm)
 *   0x24  u32       filament used, tool 1 (cm)
 *   0x28..0x39      misc display fields (zeros are accepted)
 *   0x3a  BMP       80x60 24bpp thumbnail
 *   ....  gcode
 */
export class GcodeToGx {
    private static readonly Magic = 'xgcode 1.0';

    /**
     * Returns true if the data is already in .gx format.
     */
    public static IsGxFormat(data: Buffer): boolean {
        return data.length >= GcodeToGx.Magic.length &&
            data.toString('latin1', 0, GcodeToGx.Magic.length) === GcodeToGx.Magic;
    }

    /**
     * Wraps plain gcode in a .gx header. If the data is already a .gx it is
     * returned unchanged.
     */
    public static Convert(gcode: Buffer): Buffer {
        if (GcodeToGx.IsGxFormat(gcode)) {
            return gcode;
        }

        const meta = gcode.toString('latin1', 0, Math.min(gcode.length, 4096));
        const timeMatch = meta.match(/;TIME:(\d+)/);
        const printTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;
        const filMatch = meta.match(/;Filament used:\s*([\d.]+)\s*m/i);
        const filamentCm = filMatch ? Math.round(parseFloat(filMatch[1]) * 100) : 0;

        const bmp = GcodeToGx.BuildThumbnail();
        const bitmapOffset = 58;
        const gcodeOffset = bitmapOffset + bmp.length; // 14512

        const header = Buffer.alloc(bitmapOffset);
        header.write(GcodeToGx.Magic + '\n', 0, 'latin1');
        header.writeUInt32LE(bitmapOffset, 0x10);
        header.writeUInt32LE(gcodeOffset, 0x14);
        header.writeUInt32LE(gcodeOffset, 0x18);
        header.writeUInt32LE(printTime, 0x1c);
        header.writeUInt32LE(filamentCm, 0x20);
        // 0x24..0x39 left as zeros - the printer accepts them.

        return Buffer.concat([header, bmp, gcode]);
    }

    /**
     * Builds a plain 80x60 24bpp BMP used as the print thumbnail. The image is a
     * flat colour - the printer just needs a valid bitmap of the expected size.
     */
    private static BuildThumbnail(): Buffer {
        const width = 80;
        const height = 60;
        const pixels = width * 3 * height; // rows are already 4-byte aligned
        const size = 54 + pixels;          // 14454
        const bmp = Buffer.alloc(size);
        bmp.write('BM', 0, 'latin1');
        bmp.writeUInt32LE(size, 2);
        bmp.writeUInt32LE(54, 10);     // pixel data offset
        bmp.writeUInt32LE(40, 14);     // DIB header size
        bmp.writeInt32LE(width, 18);
        bmp.writeInt32LE(height, 22);
        bmp.writeUInt16LE(1, 26);      // planes
        bmp.writeUInt16LE(24, 28);     // bits per pixel
        bmp.writeUInt32LE(pixels, 34); // image size
        bmp.fill(0x2c, 54);            // dark grey fill
        return bmp;
    }
}

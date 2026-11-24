// A stub of a FlashForge Adventurer / Monoprice Voxel printer.
//
// This models the real network print protocol used by the FlashForge
// Adventurer III Pro (firmware v2.x), verified by probing a real printer:
//
//   ~M601 S1                      -> take control
//   ~M115 / ~M119 / ~M105         -> info / status / temperature
//   ~M28 <size> 0:/user/<name>    -> begin a file transfer of <size> bytes
//   <raw file bytes>              -> the file content, sent verbatim (NO framing)
//   ~M29                          -> end the transfer, printer saves the file
//   ~M23 0:/user/<name>           -> start printing the file
//   ~M602                         -> release control
//
// Important: this firmware writes the bytes received after M28 straight to the
// file until it has <size> of them. There is NO 5A5AA5A5 packet framing, no
// per-chunk CRC, and no per-chunk acknowledgement. (Older models used a framed
// protocol; sending those 16-byte headers to this printer corrupts the file and
// it reports a "file format error".)
//
// The stub reassembles the received file and, on M29, checks that exactly
// <size> bytes arrived, then emits a 'fileReceived' event for test harnesses.

const net = require('net');

// Failure modes for testing the client, set through environment variables:
//   STUB_GO_SILENT_AFTER_MS=15000         stop answering (but keep the socket
//                                         open) this long after a client
//                                         connects, like a Wi-Fi drop
//   STUB_STALL_UPLOAD_AT_BYTES=1000000    stop reading the socket once this many
//                                         bytes of an upload have arrived, like
//                                         a printer that can't keep up
//   STUB_MACHINE_STATUS=BUILDING_FROM_SD  machine status reported by M119
const goSilentAfterMs = parseInt(process.env.STUB_GO_SILENT_AFTER_MS || '', 10);
const stallUploadAtBytes = parseInt(process.env.STUB_STALL_UPLOAD_AT_BYTES || '', 10);
const machineStatus = process.env.STUB_MACHINE_STATUS || 'READY';

const server = net.createServer((socket) => {
    // 'command' while reading text gcode lines, 'receiving' while reading the
    // raw file bytes that follow an M28.
    let mode = 'command';

    // Bytes that have arrived but not yet been consumed.
    let pending = Buffer.alloc(0);

    // State for the in-progress file transfer.
    let transfer = null;

    // Last file successfully saved via M29, used to answer M23 size queries.
    let lastSavedFile = null;

    // Whether this socket already sent a successful M601.
    let hasControl = false;

    // Whether the enclosure light is currently on.
    let lightOn = false;

    const connectedAt = Date.now();
    let silent = false;
    let stalled = false;

    console.log('Client connected');

    const respond = (text) => {
        if (!silent && Number.isFinite(goSilentAfterMs) && Date.now() - connectedAt > goSilentAfterMs) {
            silent = true;
            console.log('!! Going silent (STUB_GO_SILENT_AFTER_MS)');
        }
        if (!silent) {
            socket.write(text + '\r\n');
        }
    };

    const beginTransfer = (size, fileName) => {
        transfer = { size: size, fileName: fileName, received: Buffer.alloc(0) };
        console.log('-> M28: expecting ' + size + ' raw bytes for "' + fileName + '"');
        respond('CMD M28 Received.');
        respond('Writing to file: ' + fileName.replace('0:/user/', '/data/'));
        respond('ok');
        mode = 'receiving';
    };

    const consumeFileBytes = () => {
        const remaining = transfer.size - transfer.received.length;
        const take = Math.min(remaining, pending.length);
        transfer.received = Buffer.concat([transfer.received, pending.subarray(0, take)]);
        pending = pending.subarray(take);

        if (!stalled && Number.isFinite(stallUploadAtBytes) && transfer.received.length >= stallUploadAtBytes) {
            stalled = true;
            socket.pause();
            console.log('!! Stalling the upload at ' + transfer.received.length + ' bytes (STUB_STALL_UPLOAD_AT_BYTES)');
        }

        const pct = Math.floor((transfer.received.length / transfer.size) * 100);
        console.log('   received ' + transfer.received.length + '/' + transfer.size + ' (' + pct + '%)');

        if (transfer.received.length >= transfer.size) {
            console.log('   all declared bytes received, awaiting M29');
            mode = 'command';
        }
    };

    const processCommandLine = (line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return;
        }
        if (!trimmed.startsWith('~')) {
            console.log('-> (ignored non-command) ' + JSON.stringify(trimmed));
            return;
        }
        const parts = trimmed.substring(1).split(' ');
        const command = parts[0];

        switch (command) {
            case 'M601':
                respond('CMD M601 Received.');
                if (hasControl) {
                    respond('Control failed.');
                } else {
                    respond('Control Success V2.1.');
                    hasControl = true;
                }
                respond('ok');
                return;
            case 'M602':
                respond('CMD M602 Received.');
                respond('Control Release.');
                hasControl = false;
                respond('ok');
                return;
            case 'M28': {
                const size = parseInt(parts[1], 10);
                const fileName = parts.slice(2).join(' ');
                if (!Number.isFinite(size) || size <= 0) {
                    console.error('  !! M28 with invalid size: ' + JSON.stringify(trimmed));
                    respond('CMD M28 Received.');
                    respond('ok');
                    return;
                }
                beginTransfer(size, fileName);
                return;
            }
            case 'M29': {
                respond('CMD M29 Received.');
                if (transfer) {
                    if (transfer.received.length === transfer.size) {
                        console.log('<- M29: TRANSFER OK — ' + transfer.received.length +
                            ' bytes received for "' + transfer.fileName + '"');
                    } else {
                        console.error('<- M29: TRANSFER SIZE MISMATCH — received ' +
                            transfer.received.length + ' of ' + transfer.size + ' bytes');
                    }
                    lastSavedFile = {
                        fileName: transfer.fileName.replace(/^0:\/user\//, ''),
                        size: transfer.received.length,
                    };
                    server.emit('fileReceived', transfer);
                    transfer = null;
                }
                respond('Done saving file.');
                respond('ok');
                return;
            }
            case 'M119':
                respond('CMD M119 Received.');
                respond('Endstop: X-max:0 Y-max:0 Z-max:0');
                respond('MachineStatus: ' + machineStatus);
                respond('MoveMode: ' + (machineStatus === 'READY' ? 'READY' : 'MOVING'));
                respond('Status: S:1 L:' + (lightOn ? '1' : '0') + ' J:0 F:0');
                respond('LED: ' + (lightOn ? '1' : '0'));
                respond('CurrentFile: ');
                respond('ok');
                return;
            case 'M146':
                respond('CMD M146 Received.');
                lightOn = trimmed.includes('r255');
                respond('ok');
                return;
            case 'M115':
                respond('CMD M115 Received.');
                respond('Machine Type: FlashForge Adventurer III Pro');
                respond('Machine Name: Stub Printer');
                respond('Firmware: v2.0.9');
                respond('SN: STUB00000000');
                respond('X: 150 Y: 150 Z: 150');
                respond('Tool Count: 1');
                respond('ok');
                return;
            case 'M105': {
                // An idle printer at room temperature, in the v2.x format.
                const nozzle = 23 + Math.round(Math.random());
                respond('CMD M105 Received.');
                respond('T0:' + nozzle + '/0 B:22/0');
                respond('ok');
                return;
            }
            case 'M503':
                respond('CMD M503 Received.');
                respond('echo:Steps per unit:');
                respond('echo: M92 X140.00 Y140.00 Z1600.00 E162.02');
                respond('echo:Maximum feedrates (units/s):');
                respond('echo: M203 X300.00 Y300.00 Z30.00 E45.00');
                respond('ok');
                return;
            case 'M23': {
                const requestedPath = parts.slice(1).join(' ');
                const requestedName = requestedPath.replace(/^0:\/user\//, '');
                respond('CMD M23 Received.');
                if (lastSavedFile && lastSavedFile.fileName === requestedName) {
                    respond('File opened: ' + lastSavedFile.fileName + ' Size: ' + lastSavedFile.size);
                    respond('File selected');
                } else {
                    respond('File opened: ' + requestedName + ' Size: 0');
                }
                respond('ok');
                console.log('<- M23: print started for ' + requestedPath);
                return;
            }
            default:
                respond('CMD ' + command + ' Received.');
                respond('ok');
                return;
        }
    };

    const drain = () => {
        // Alternate between consuming raw file bytes and text command lines until
        // no more complete units are available.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (mode === 'receiving') {
                if (pending.length === 0) {
                    return;
                }
                consumeFileBytes();
                continue;
            }

            const newline = pending.indexOf(0x0a);
            if (newline === -1) {
                return;
            }
            const line = pending.subarray(0, newline).toString('utf8');
            pending = pending.subarray(newline + 1);
            processCommandLine(line);
        }
    };

    socket.on('data', (data) => {
        pending = Buffer.concat([pending, data]);
        drain();
    });

    socket.on('error', () => { /* client disconnected */ });
    socket.on('close', () => console.log('Client disconnected'));
});

server.listen(8899, '127.0.0.1', () => {
    console.log('Stub printer listening on 127.0.0.1:8899 (raw M28 protocol)');
});

module.exports = server;

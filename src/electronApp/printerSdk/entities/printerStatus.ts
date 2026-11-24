
import { Vector3 } from './vector3';
import { IPrinterResponse } from './iPrinterResponse';

export class PrinterStatus implements IPrinterResponse
 {
     /**
      * Gets the current endstop values.
      */
     public Endstop: Vector3;

     /**
      * Gets the current machine status.
      */
     public MachineStatus: string;

     /**
      * Gets the current move mode.
      */
     public MoveMode: string;

     /**
      * Whether the enclosure light is on, when reported by the printer.
      */
     public LightOn: boolean | null;

     /**
      * Initializes a new instance of the PrinterStatus class.
      * @param responses The responses sent from the printer after the endstop status was requested.
      */
     constructor(responses: Array<string>)
     {
         // Example interaction:
         //
         // CMD M119 Received.
         // Endstop: X-max:1 Y-max:0 Z-max:0
         // MachineStatus: READY
         // MoveMode: READY
         // Status: S:0 L:0 J:0 F:0
         // LED: 1
         // ok
         let statusLight: boolean | null = null;
         let ledLight: boolean | null = null;

         responses.forEach(response => {
             const parts = response.split(/\:(.+)/);
             if (parts.length > 1)
             {
                 switch (parts[0].trim().toLowerCase())
                 {
                     case 'machinestatus':
                         this.MachineStatus = parts[1].trim();
                         break;

                     case 'movemode':
                         this.MoveMode = parts[1].trim();
                         break;

                     case 'status':
                         statusLight = PrinterStatus.ParseStatusLight(parts[1]);
                         break;

                     case 'led':
                         ledLight = PrinterStatus.ParseLedLight(parts[1]);
                         break;

                     case 'endstop':
                         this.Endstop = PrinterStatus.GetEndstopVector(parts[1]);
                         break;
                 }
             }
         });

         this.LightOn = ledLight ?? statusLight;
     }

     /**
      * Extracts the endstop vector fro the string representation.
      * @param strVal The string representation send by the printer.
      */
     private static GetEndstopVector(strVal: string): Vector3
     {
         // Example format: X-max:1 Y-max:0 Z-max:0
         const result = new Vector3(Number.NaN, Number.NaN, Number.NaN);

         // First break out each of the X/Y/Z planes
         const xyzParts = strVal.split(' ');
         xyzParts.forEach(plane => {
             // For each plane break into a key and value
             const planeParts = plane.split(':');
             if (planeParts.length === 2)
             {
                 // Attempt to parse the value
                 const val = Number.parseFloat(planeParts[1]);
                 if (!Number.isNaN(val))
                 {
                     // Assign the parsed value to the relevant plane
                     switch (planeParts[0].toLocaleLowerCase())
                     {
                         case 'x-max':
                             result.X = val;
                             break;
                         case 'y-max':
                             result.Y = val;
                             break;
                         case 'z-max':
                             result.Z = val;
                             break;
                     }
                 }
             }
         });
         return result;
     }

     /**
      * Reads the light flag from a Status line such as "S:1 L:0 J:0 F:0".
      */
     private static ParseStatusLight(statusValue: string): boolean | null {
         const match = statusValue.match(/\bL:(\d+)/i);

         if (match == null) {
             return null;
         }

         return match[1] === '1';
     }

     /**
      * Reads the light flag from an LED line such as "1" or "ON".
      */
     private static ParseLedLight(ledValue: string): boolean | null {
         const normalized = ledValue.trim().toLowerCase();

         if (normalized === '1' || normalized === 'on') {
             return true;
         }

         if (normalized === '0' || normalized === 'off') {
             return false;
         }

         return null;
     }
 }

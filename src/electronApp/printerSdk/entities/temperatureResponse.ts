
import { IPrinterResponse } from './iPrinterResponse';

export class TemperatureResponse implements IPrinterResponse {
    /**
     * Gets the temperature of tool 0;
     */
    public Tool0Temp: number;

    /**
     * Gets the target temperature of tool 0;
     */
    public Tool0TargetTemp: number;

    /**
     * Gets the temperature of the build plate.
     */
    public BuildPlateTemp: number;

    /**
     * Gets the target temperature of the build plate.
     */
    public BuildPlateTargetTemp: number;

    /**
     * Initializes a new instance of the TemperatureResponse class.
     */
    constructor(responses: Array<string>) {
        // Adventurer III Pro v2.x:  T0:24/0 B:14/0
        // Older format with spaces: T0:25 /250 B:17/150
        responses.forEach(response => {
            const toolMatch = response.match(/T0?:([\d.]+)\s*\/\s*([\d.]+)/);
            if (toolMatch) {
                this.Tool0Temp = Number.parseFloat(toolMatch[1]);
                this.Tool0TargetTemp = Number.parseFloat(toolMatch[2]);
            }

            const bedMatch = response.match(/\bB:([\d.]+)\s*\/\s*([\d.]+)/);
            if (bedMatch) {
                this.BuildPlateTemp = Number.parseFloat(bedMatch[1]);
                this.BuildPlateTargetTemp = Number.parseFloat(bedMatch[2]);
            }
        });

        this.ApplyAmbientBedCorrection();
    }

    /**
     * Adventurer bed thermistors read roughly 10-12 °C below ambient when cold.
     * Use the nozzle reading as a stand-in when the bed is not being heated.
     */
    private ApplyAmbientBedCorrection(): void {
        if (this.BuildPlateTargetTemp !== 0) {
            return;
        }

        if (!Number.isFinite(this.Tool0Temp) || !Number.isFinite(this.BuildPlateTemp)) {
            return;
        }

        if (this.BuildPlateTemp < this.Tool0Temp - 3) {
            this.BuildPlateTemp = this.Tool0Temp;
        }
    }
}

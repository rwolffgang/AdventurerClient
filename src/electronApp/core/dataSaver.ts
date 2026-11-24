/**
 * A file that was recently sent to the printer.
 */
export interface RecentPrintEntry {
  filePath: string;
  displayName: string;
}

/**
 * Save data locally
 */
export class DataSaver {
  /**
   * The key for the storage of the last used IPs
   */
  static readonly LastIPsKey = "lastIPs";

  /**
   * Max amount of IPs to be saved
   */
  static readonly MaxIPs = 5;

  /**
   * Session flag set when the user explicitly disconnects so we do not
   * immediately auto-connect again on the connect screen.
   */
  static readonly SkipAutoConnectKey = "skipAutoConnect";

  /**
   * Whether the camera panel is shown on the main screen.
   */
  static readonly ShowCameraKey = "showCamera";

  /**
   * Whether the app auto-connects to the last printer on launch.
   */
  static readonly AutoConnectKey = "autoConnect";

  /**
   * The key for recently printed file paths.
   */
  static readonly RecentPrintsKey = "recentPrints";

  /**
   * Max number of recent prints to remember.
   */
  static readonly MaxRecentPrints = 5;

  /**
   * Saves the IP-Address into the list of last used IPs
   * @param ip The ip address to be saved
   */
  public static SaveLastIP(ip: string): void {
    let lastIPs = localStorage.getItem(this.LastIPsKey);

    if (lastIPs != null) { // If there are already IPs saved
      let ipArray: string[] = lastIPs.toString().split(",");
      let index = ipArray.indexOf(ip);

        if (index != -1) { // If the IP is already in the list, move it to first place
          this.array_move(ipArray, index, 0);
        }
        else { // If it's not in the list
          if (ipArray.length == this.MaxIPs) { // if the max amount of IPs is reached
            ipArray.pop(); // remove the last one
          }
          // add it and put it in first place
          let length = ipArray.push(ip);
          this.array_move(ipArray, length - 1, 0);
        }

      localStorage.setItem(this.LastIPsKey, ipArray.toString());
    } else { // If there are no IPs saved
      let ipArray: string[];
      ipArray = [ip];
      localStorage.setItem(this.LastIPsKey, ipArray.toString());
    }
  }

  /**
   * Swaps the elements at old_index and new_index
   * @param arr Array in which the elements are being moved
   * @param old_index The index of the element to be moved
   * @param new_index The index of the position the element will be moved to
   */
  static array_move(arr, old_index, new_index): void {
    if (new_index >= arr.length) {
      var k = new_index - arr.length + 1;
      while (k--) {
        arr.push(undefined);
      }
    }
    arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
    return arr; // for testing
  }

  /**
   * Returns an array of the last used IPs
   */
  public static GetSavedIPs(): string[] {
    let lastIPs = localStorage.getItem(this.LastIPsKey);
    if (lastIPs != null) {
      let ipArray: string[] = lastIPs.toString().split(",");
      return ipArray;
    }
    return [];
  }

  /**
   * Records whether auto-connect should be skipped on the connect screen.
   */
  public static SetSkipAutoConnect(skip: boolean): void {
    if (skip) {
      sessionStorage.setItem(this.SkipAutoConnectKey, "1");
    } else {
      sessionStorage.removeItem(this.SkipAutoConnectKey);
    }
  }

  /**
   * Returns true after the user has manually disconnected this session.
   */
  public static ShouldSkipAutoConnect(): boolean {
    return sessionStorage.getItem(this.SkipAutoConnectKey) === "1";
  }

  /**
   * Returns whether the camera panel should be shown.
   */
  public static GetShowCamera(): boolean {
    return localStorage.getItem(this.ShowCameraKey) === "1";
  }

  /**
   * Saves whether the camera panel should be shown.
   */
  public static SetShowCamera(show: boolean): void {
    localStorage.setItem(this.ShowCameraKey, show ? "1" : "0");
  }

  /**
   * Returns whether auto-connect on launch is enabled.
   */
  public static GetAutoConnectEnabled(): boolean {
    return localStorage.getItem(this.AutoConnectKey) !== "0";
  }

  /**
   * Saves whether auto-connect on launch is enabled.
   */
  public static SetAutoConnectEnabled(enabled: boolean): void {
    localStorage.setItem(this.AutoConnectKey, enabled ? "1" : "0");
  }

  /**
   * Records a file path in the recent prints list.
   */
  public static SaveRecentPrint(filePath: string, displayName: string): void {
    let entries = this.GetRecentPrints();
    const existingIndex = entries.findIndex(entry => entry.filePath === filePath);

    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }

    entries.unshift({ filePath, displayName });

    if (entries.length > this.MaxRecentPrints) {
      entries = entries.slice(0, this.MaxRecentPrints);
    }

    localStorage.setItem(this.RecentPrintsKey, JSON.stringify(entries));
  }

  /**
   * Returns recently printed files, most recent first.
   */
  public static GetRecentPrints(): RecentPrintEntry[] {
    const raw = localStorage.getItem(this.RecentPrintsKey);

    if (raw == null) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(entry => {
        return typeof entry?.filePath === 'string'
          && typeof entry?.displayName === 'string';
      });
    } catch {
      return [];
    }
  }
}

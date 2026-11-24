import { Component } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { PrinterService } from '../../services/printerService';
import { UiStateService } from '../../services/uiStateService';
import { ErrorLogger } from '../../../core/errorLogger';
import { GetAppInfo } from '../../../core/appInfo';

const path = window.require('path');

interface DebugLogLine {
  text: string;
  color: string;
}

/**
 * Settings and debug controls shown in the settings panel.
 */
@Component({
  selector: 'app-debug',
  templateUrl: './debug.component.html',
  styleUrls: ['./debug.component.css']
})
export class DebugComponent {
  public readonly LogFilePath = ErrorLogger.GetLogFilePath();
  public readonly LogFileDirectory = path.dirname(this.LogFilePath) + path.sep;
  public readonly LogFileName = path.basename(this.LogFilePath);
  public readonly AppVersion: string = GetAppInfo().version;
  public LogLines: DebugLogLine[] = [];

  PrinterCommand = new FormControl('', [Validators.required]);

  constructor(
    public UiState: UiStateService,
    private printerService: PrinterService) { }

  public ToggleCamera(): void {
    this.UiState.ToggleCamera();
  }

  public ToggleAutoConnect(): void {
    this.UiState.ToggleAutoConnect();
  }

  public OpenLogFile(): void {
    const { shell } = window.require('electron');
    shell.openPath(this.LogFilePath);
  }

  public async sendCommand(): Promise<void> {
    const command = this.PrinterCommand.value.trim();
    if (command.length === 0) {
      return;
    }

    const newLines: DebugLogLine[] = [
      { text: '> ' + command, color: '#9C948C' },
    ];

    this.PrinterCommand.setValue('');

    try {
      const responseLines = await this.printerService.SendDebugCommandAsync(command);

      if (responseLines.length === 0) {
        newLines.push({ text: '(no response text)', color: '#D8D2CC' });
      } else {
        for (const line of responseLines) {
          newLines.push({ text: line, color: '#D8D2CC' });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      newLines.push({ text: message, color: '#E8A598' });
    }

    this.LogLines = [...this.LogLines, ...newLines].slice(-120);
  }
}

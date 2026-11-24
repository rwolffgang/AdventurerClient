import { Component, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { PrinterService } from '../../services/printerService';
import { ErrorLogger } from '../../../core/errorLogger';
import { FormControl, Validators } from '@angular/forms';
import { DataSaver } from '../../../core/dataSaver';

/**
 * The connect form component, shown when not connected to a printer.
 */
@Component({
  selector: 'app-connect-form',
  templateUrl: './connect-form.component.html',
  styleUrls: ['./connect-form.component.css']
})
export class ConnectFormComponent implements OnInit, AfterViewInit {
  /**
   * Gets a value indicating that a connection attempt is in progress.
   */
  public isConnecting = false;

  /**
   * Gets a value indicating that the error message should be shown.
   */
  public isError = false;

  /**
   * Whether the recent printer suggestions dropdown is open.
   */
  public SuggestionsOpen = false;

  /**
   * Filtered recent printer addresses for the suggestions dropdown.
   */
  public FilteredSuggestions: string[] = [];

  /**
   * Whether auto-connect is enabled in settings.
   */
  public AutoConnectEnabled = DataSaver.GetAutoConnectEnabled();

  /**
   * Saved printer IP addresses.
   */
  private savedAddresses: string[] = [];

  /**
   * Whether auto-connect was attempted during initialization.
   */
  private autoConnectAttempted = false;

  /**
   * Gets the printer address form control.
   */
  PrinterAddress = new FormControl('', [Validators.required]);

  /**
   * Element reference for the IP address input field.
   */
  @ViewChild('ipInput') ipInputField: ElementRef;

  /**
   * Initializes a new instance of the ConnectFormComponent.
   */
  constructor(private printerService: PrinterService) {
  }

  /**
   * Invoked when the Angular component is initialized.
   */
  ngOnInit(): void {
    this.savedAddresses = DataSaver.GetSavedIPs();
    this.AutoConnectEnabled = DataSaver.GetAutoConnectEnabled();
    this.UpdateSuggestions();

    this.PrinterAddress.valueChanges.subscribe(() => {
      this.UpdateSuggestions();
      this.isError = false;
    });

    if (this.savedAddresses.length > 0) {
      this.PrinterAddress.setValue(this.savedAddresses[0]);

      if (this.AutoConnectEnabled && !DataSaver.ShouldSkipAutoConnect()) {
        this.autoConnectAttempted = true;
        void this.connect();
      }
    }
  }

  /**
   * Invoked after the view is initialized.
   */
  ngAfterViewInit(): void {
    if (!this.autoConnectAttempted) {
      this.ipInputField?.nativeElement?.focus();
    }
  }

  /**
   * Opens the suggestions dropdown.
   */
  public OpenSuggestions(): void {
    this.UpdateSuggestions();
    this.SuggestionsOpen = this.FilteredSuggestions.length > 0;
  }

  /**
   * Closes the suggestions dropdown after a short delay.
   */
  public BlurSuggestions(): void {
    window.setTimeout(() => {
      this.SuggestionsOpen = false;
    }, 130);
  }

  /**
   * Selects a suggestion from the recent printers list.
   */
  public SelectSuggestion(address: string): void {
    this.PrinterAddress.setValue(address);
    this.SuggestionsOpen = false;
  }

  /**
   * Invoked when the connect button is pressed.
   */
  public async connect(): Promise<unknown> {
    const address = this.PrinterAddress.value.trim();
    if (address.length === 0) {
      return;
    }

    this.isConnecting = true;
    this.isError = false;
    this.SuggestionsOpen = false;

    try {
      await this.printerService.ConnectAsync(address);
      DataSaver.SaveLastIP(address);
      DataSaver.SetSkipAutoConnect(false);
    } catch (error) {
      this.isError = true;
      ErrorLogger.NonFatalError(error);
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Updates the filtered suggestions list.
   */
  private UpdateSuggestions(): void {
    const query = (this.PrinterAddress.value ?? '').trim().toLowerCase();
    this.FilteredSuggestions = this.savedAddresses.filter(address => {
      return address !== this.PrinterAddress.value
        && (query.length === 0 || address.toLowerCase().includes(query));
    });
  }
}

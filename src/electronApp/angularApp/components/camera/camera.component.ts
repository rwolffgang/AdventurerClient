import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { PrinterService } from '../../services/printerService';
import { CameraState, PrinterCamera } from '../../../printerSdk/printerCamera';

/**
 * Component that shows the printer's camera stream.
 */
@Component({
  selector: 'app-camera',
  templateUrl: './camera.component.html',
  styleUrls: ['./camera.component.css']
})
export class CameraComponent implements OnInit, OnDestroy {

  /**
   * Whether the camera stream is currently available.
   */
  public CameraAvailable = true;

  /**
   * The image element that displays the stream.
   */
  @ViewChild('ImageElement') private imageElement: ElementRef;

  /**
   * The camera this component is subscribed to. Each connection to the
   * printer has its own camera, so this changes when the app reconnects.
   */
  private camera: PrinterCamera | null = null;

  /**
   * Initializes a new instance of the CameraComponent class.
   * @param printerService The printer service.
   */
  constructor(private printerService: PrinterService) {
  }

  /**
   * Invoked when the Angular component is initialized.
   */
  ngOnInit(): void {
    this.printerService.ConnectionStateChanged.Register(this.OnConnectionStateChanged, this);
    this.SubscribeToCamera();
  }

  /**
   * Invoked when the Angular component is destroyed.
   */
  ngOnDestroy(): void {
    this.printerService.ConnectionStateChanged.Unregister(this.OnConnectionStateChanged);
    this.UnsubscribeFromCamera();
  }

  /**
   * Follows the camera of the current connection, including after a reconnect.
   */
  private OnConnectionStateChanged(connected: boolean): void {
    if (connected) {
      this.SubscribeToCamera();
    } else {
      this.UnsubscribeFromCamera();
    }
  }

  /**
   * Subscribes to the camera of the current printer connection.
   */
  private SubscribeToCamera(): void {
    this.UnsubscribeFromCamera();

    if (!this.printerService.GetIsConnected()) {
      return;
    }

    this.camera = this.printerService.GetCamera();
    this.camera.NewFrame.Register(this.OnNewFrame, this);
    this.camera.CameraStateChanged.Register(this.OnCameraStateChanged, this);
    this.CameraAvailable = this.camera.CameraState !== CameraState.NotAvailable;
  }

  /**
   * Stops listening to the camera this component last subscribed to.
   */
  private UnsubscribeFromCamera(): void {
    if (this.camera == null) {
      return;
    }

    this.camera.NewFrame.Unregister(this.OnNewFrame);
    this.camera.CameraStateChanged.Unregister(this.OnCameraStateChanged);
    this.camera = null;
  }

  /**
   * Invoked when there is a new frame from the camera.
   * @param frame The frame.
   */
  private OnNewFrame(frame: string): void {
    if (this.imageElement && this.imageElement.nativeElement) {
      // The camera provides multiple frames per second, so to get good performance bypass
      // Angular's change detection and set the frame directly.
      this.imageElement.nativeElement.src = frame;
    }
  }

  /**
   * Invoked when the camera state changes.
   * @param cameraState The new camera state.
   */
  private OnCameraStateChanged(cameraState: CameraState): void {
    this.CameraAvailable = cameraState === CameraState.Available;
  }
}

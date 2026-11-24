import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';

import { AppComponent } from './components/app/app.component';
import { CameraComponent } from './components/camera/camera.component';
import { ConnectFormComponent } from './components/connect-form/connect-form.component';
import { DebugComponent } from './components/debug/debug.component';
import { PrintComponent } from './components/print/print.component';
import { StatusComponent } from './components/status/status.component';
import { DragDropDirective } from './directives/dragDropDirective';

/**
 * The app module.
 */
@NgModule({
  declarations: [
    AppComponent,
    CameraComponent,
    ConnectFormComponent,
    DebugComponent,
    PrintComponent,
    StatusComponent,
    DragDropDirective,
  ],
  imports: [
    BrowserModule,
    ReactiveFormsModule,
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }

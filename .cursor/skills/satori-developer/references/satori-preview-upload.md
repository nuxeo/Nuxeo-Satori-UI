<!-- Generated from packages/satori-preview/upload/docs/upload-overview.mdx. Do not edit here; edit the source MDX. -->

# Upload

The Upload component allows users to upload files with a drag-and-drop interface and customizable styles. It's designed to provide a seamless file upload experience throughout your application.

## Key Features

- Directive to handle file selection to load in Angular applications.
- Supports both button click file selection and drag-and-drop.
- Compatible with button or drop area usage.
- Provides a simple component UI for file drop area.

## Demo Showcase

## Upload Button

```html
<button
  mat-flat-button
  type="button"
  satUpload
  [input]="fileInput"
  (filesLoaded)="onFilesLoaded($event)"
  (dragEnter)="onDragenter($event)"
  (dragLeave)="onDragleave($event)"
  (drop)="onDrop($event)"
>
  <mat-icon [svgIcon]="'upload'"></mat-icon>
  Upload files
</button>
<input #fileInput type="file" hidden [multiple]="true" />
```

## Upload Area

```html
<sat-upload-area (filesLoaded)="onFilesLoaded($event)" (drop)="onDrop($event)">
  <div class="demo-area">
    <p>This area can receive files by drag and drop.</p>
    <p>
      The upload-area must be used in combination with another accessible upload UI.<br />
      See
      <a href="index.html?path=/docs/satori-preview-upload--overview#upload-with-file-table"
        >examples</a
      >
      for more details.
    </p>
  </div>
</sat-upload-area>
```

```scss
.demo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  justify-content: center;
  height: 250px;
}
```

## Guidelines

### Do not use upload area alone

The upload drop area is not intended to be used alone, without an upload button.

It is not accessible or usable for keyboard-only users or for devices that do not support drag and drop.

## Examples

### Upload with file table

This sample demonstrates an upload button integrated with a table to display the output
of files loaded along with pagination, in combination with an upload drop area on the table.

```html
<div class="wrapper">
  <div>
    <button
      mat-stroked-button
      type="button"
      satUpload
      [input]="fileInput"
      (filesLoaded)="onFilesLoaded($event)"
      aria-describedby="upload-table-file-status"
    >
      <mat-icon [svgIcon]="'upload'" data-testid="upload-icon"></mat-icon>
      Upload files
    </button>
    <div
      id="upload-table-file-status"
      aria-live="polite"
      class="cdk-visually-hidden"
      data-testid="status-region"
    >
      @if (dataSource.data.length > 0) { Files uploaded: {{ dataSourceToFileNames() }} }
    </div>
  </div>
  <input #fileInput type="file" hidden [multiple]="true" data-testid="file-input" />

  <sat-upload-area (filesLoaded)="onFilesLoaded($event)" data-testid="upload-area">
    @if (dataSource.data.length > 0) {
    <div class="table-wrapper">
      <table mat-table [dataSource]="dataSource">
        <!-- Filename Column -->
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>File</th>
          <td mat-cell *matCellDef="let row">{{row.name}}</td>
        </ng-container>

        <!-- Type Column -->
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let row">{{row.type}}</td>
        </ng-container>

        <!-- Size Column -->
        <ng-container matColumnDef="size">
          <th mat-header-cell *matHeaderCellDef>Size</th>
          <td mat-cell *matCellDef="let row">{{row.size}}</td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
      </table>
    </div>
    } @else {
    <p>Or drag and drop files here to upload</p>
    }
  </sat-upload-area>
  <mat-paginator
    [style.display]="dataSource.data.length < 1 ? 'none' : null"
    [length]="dataSource.data.length"
    [pageSizeOptions]="[5, 10, 25, 100]"
    aria-label="Select page of files"
  ></mat-paginator>
</div>
```

```scss
@use '@angular/material' as mat;

.wrapper {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  min-height: 600px;
  gap: 24px;
  padding: 16px;
  background-color: var(--mat-sys-surface-container-lowest);
  border-radius: var(--mat-sys-corner-large);

  @include mat.table-overrides(
    (
      background-color: var(--mat-sys-surface-container-lowest),
    )
  );

  @include mat.paginator-overrides(
    (
      container-background-color: var(--mat-sys-surface-container-lowest),
    )
  );

  > * {
    flex: 0 0 auto;
  }

  /* Let the center area able to grow and fill available space */
  > sat-upload-area {
    flex-grow: 9999;
  }
}

.table-wrapper {
  overflow: auto;
  max-width: 100%;
}
```

```typescript
export class UploadTableExample implements AfterViewInit {
  displayedColumns: string[] = ['name', 'type', 'size'];
  dataSource: MatTableDataSource<FileData> = new MatTableDataSource();
  private _snackBar = inject(MatSnackBar);

  readonly paginator = viewChild<MatPaginator>(MatPaginator);

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator() ?? null;
  }

  onFilesLoaded(files: File[]) {
    if (!files || files.length < 1) {
      return;
    }

    const filesData = files.map((file) => ({
      name: file.name,
      type: file.type,
      size: `${(file.size / 1024 ** 2).toFixed(2)} MB`,
    }));

    this.dataSource.data = [...filesData, ...this.dataSource.data];

    this._snackBar.open('Files successfully added.', undefined, { duration: 3000 });
  }

  dataSourceToFileNames(): string {
    return this.dataSource.data.map((fileData) => fileData.name).join(', ');
  }
}
```

## API

```ts
import { SatUploadModule } from '@hylandsoftware/satori-preview/upload';
```

### `<sat-upload-area>`

**Content slots** (project via directive)

- `satUpload` — Directive to enable file upload functionality via drag-and-drop or file input dialog
  - `input: HTMLInputElement` — Reference to a file input element
  - `filesLoaded: File[]` — Emits an event containing the selected or dropped files

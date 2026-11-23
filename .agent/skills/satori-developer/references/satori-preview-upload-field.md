<!-- Generated from packages/satori-preview/upload-field/docs/upload-field-overview.mdx. Do not edit here; edit the source MDX. -->

# Upload-Field

The Upload field component allows users to upload files with a drag-and-drop interface. It's designed to provide a seamless file upload experience throughout your application. **Note:** DS-1642: Projecting `<svg>` elements is deprecated. Use `<sat-illustration>` instead.

## Key Features

- **Form Integration**: Seamlessly fits within forms.
- **Multiple File Selection**: Allows users to select and upload multiple files at once.
- **Drag and Drop Support**: Intuitive drag-and-drop functionality for easy file uploads.
- **Error Display**: Provides a way to display upload errors messages.

## Demo Showcase

```html
<sat-upload-field (filesLoaded)="onFilesLoaded($event)" [uploadedFiles]="uploadedFiles">
  <mat-label>Upload files</mat-label>

  <mat-icon [svgIcon]="'upload'" aria-hidden="true" />
  <mat-hint>Max size: 500 MB. Supported types: JPG, PNG, PDF.</mat-hint>
  <input type="file" satUploadFieldInput [multiple]="true" />
</sat-upload-field>
```

## Guidelines

### Custom labels and instructions

The upload field can be customized with different labels and instructions to guide users through the upload process.
Each is managed by a child element.

#### Label

The form label is defined using a `<mat-label>` element.

```html
<sat-upload-field>
  <mat-label>Upload profile picture</mat-label>
  …
</sat-upload-field>
```

#### Button label

The button label is defined using a simple `<span>` element.

The default button label is localized version of “Browse or drop files here to upload”.
It can be useful to specify the type of files to upload to guide users

```html
<sat-upload-field>
  …
  <span>Browse or drop an image here</span>
  …
</sat-upload-field>
```

#### Hint

The hint text is defined using a simple `<mat-hint>` element.

It’s recommended to use it to specify supported file formats or size limits.

```html
<sat-upload-field>
  …
  <mat-hint>Supported formats: JPG, PNG</mat-hint>
  …
</sat-upload-field>
```

### Sizes

The upload field provides some custom CSS properties to control its size to adapt it to your design.

- `button-height` controls the height of the upload button.
- `button-width` controls the width of the upload button.
- `button-min-height` controls the minimum height of the upload button.

See Avatar upload example below for a practical use case of size customization.
See styling section in API page for more information about available CSS custom properties.

## Examples

### Single File Upload

Simple example of a single file upload with output displayed as a list of files.

```html
<div class="upload-field-container">
  <sat-upload-field (filesLoaded)="file.set($event[0])" [uploadedFiles]="file()">
    <mat-label>Upload a single file</mat-label>
    <mat-icon [svgIcon]="'upload'" aria-hidden="true" />
    <mat-hint>Supported types: PDF, JPG, PNG.</mat-hint>
    <input
      type="file"
      satUploadFieldInput
      [required]="true"
      accept="application/pdf, image/jpeg, image/png"
    />
  </sat-upload-field>
  @if (loadedFile(); as loadedFile) {
  <mat-list class="upload-list">
    <mat-list-item>
      <mat-icon matListItemIcon [svgIcon]="loadedFile.icon" aria-hidden="true" />
      <div matListItemTitle>{{ loadedFile.file.name }}</div>
      <button
        matListItemMeta
        mat-icon-button
        (click)="onRemoveFile()"
        [attr.aria-label]="'Remove file ' + loadedFile.file.name"
      >
        <mat-icon [svgIcon]="'x_large'" aria-hidden="true" />
      </button>
    </mat-list-item>
  </mat-list>
  }
</div>
```

```scss
@use '@angular/material' as mat;

.upload-field-container {
  max-width: 500px;
  margin: 0 auto;
}

.upload-list {
  margin-left: -16px;

  @include mat.list-overrides(
    (
      list-item-label-text-size: var(--mat-sys-body-medium-size),
      list-item-label-text-line-height: var(--mat-sys-body-medium-line-height),
      list-item-label-text-weight: var(--mat-sys-body-medium-weight),
      list-item-label-text-tracking: var(--mat-sys-body-medium-tracking),
      list-item-label-text-font: var(--mat-sys-body-medium-font),
    )
  );
}
```

```typescript
export class SingleFileUploadExample {
  readonly file = signal<File | null>(null);
  readonly loadedFile = computed(() => {
    const file = this.file();
    return file
      ? {
          file,
          icon: file.type.startsWith('image/') ? 'image' : 'page',
        }
      : null;
  });

  onRemoveFile() {
    this.file.set(null);
  }
}
```

### Confirmation of Upload

Example with output displayed as a list of files with errors by files.

```html
<div class="upload-field-container">
  <sat-upload-field (filesLoaded)="onFilesLoaded($event)" [uploadedFiles]="loadedFiles()">
    <mat-label>Upload files (file over 2MB will show error)</mat-label>
    <mat-icon [svgIcon]="'upload'" aria-hidden="true" />
    <mat-hint>Max file size: {{ maxFileSizeMB }}MB</mat-hint>
    <input type="file" satUploadFieldInput [multiple]="true" />
    @for (error of errors(); track error) {
    <mat-error class="cdk-visually-hidden">{{ error }}</mat-error>
    }
  </sat-upload-field>
  <ul class="upload-list">
    @for (file of loadedFilesWithMeta(); track file) {
    <li>
      <mat-icon [svgIcon]="file.icon" aria-hidden="true" />
      <div class="upload-list-item">
        <div class="upload-list-item-name">{{ file.file.name }}</div>
        @if (file.error) {
        <div matListItemLine class="upload-list-item-error">
          <mat-icon [svgIcon]="'error'" aria-hidden="true" />
          <div class="upload-list-item-error-text">{{ file.error }}</div>
        </div>
        }
      </div>
      <button
        mat-icon-button
        (click)="onRemoveFile(file.file)"
        [attr.aria-label]="'Remove file ' + file.file.name"
      >
        <mat-icon [svgIcon]="'x_large'" aria-hidden="true" />
      </button>
    </li>
    }
  </ul>
</div>
```

```scss
@use '@angular/material' as mat;

.upload-field-container {
  max-width: 500px;
  margin: 0 auto;
}

.upload-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0;
  font-size: var(--mat-sys-body-medium-size);
  line-height: var(--mat-sys-body-medium-line-height);
  font-weight: var(--mat-sys-body-medium-weight);
  font-family: var(--mat-sys-body-medium-font);
  letter-spacing: var(--mat-sys-body-medium-tracking);

  li {
    display: flex;
    gap: 12px;
    list-style: none;
    flex-wrap: nowrap;
    align-items: center;

    mat-icon {
      flex: 0 0 auto;
    }

    .upload-list-item {
      flex: 1;
    }

    .upload-list-item-name {
      word-break: break-all;
    }

    .upload-list-item-error {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      font-size: var(--mat-sys-body-small-size);
      color: var(--mat-sys-error);
      align-items: flex-start;

      mat-icon {
        width: 16px;
        height: 16px;
        padding-top: 2px;
      }

      .upload-list-item-error-text {
        flex: 1;
      }
    }
  }
}
```

```typescript
export class ConfirmationOfUploadExample {
  readonly maxFileSizeMB = 2;
  readonly loadedFiles = signal<File[]>([]);

  readonly loadedFilesWithMeta = computed(() => {
    return this.loadedFiles().map((file) => ({
      file,
      icon: file.type.startsWith('image/') ? 'image' : 'page',
      error:
        file.size > this.maxFileSizeMB * 1024 * 1024
          ? `File too large. Please upload a file smaller than ${this.maxFileSizeMB}MB`
          : undefined,
    }));
  });

  readonly errors = computed(() =>
    this.loadedFilesWithMeta()
      .filter((file) => file.error)
      .map((f) => `${f.file.name}: ${f.error}`),
  );

  onFilesLoaded(files: File[]) {
    this.loadedFiles.update((f) => [...f, ...files]);
  }

  onRemoveFile(file: File) {
    this.loadedFiles.update((f) => f.filter((f) => f !== file));
  }
}
```

### Avatar upload

An upload field can be customized to receive avatar images.

```html
<sat-upload-field (filesLoaded)="onFilesLoaded($event)" [uploadedFiles]="loadedFile()">
  <mat-label>Upload profile picture</mat-label>
  <mat-icon [svgIcon]="'upload'" aria-hidden="true" />
  @if (img()) {
  <img [src]="img()" alt="" />
  }
  <input type="file" #fileInput satUploadFieldInput accept="image/*" />
  @if (error()) {
  <mat-error><mat-icon [svgIcon]="'error'" aria-hidden="true" />{{ error() }}</mat-error>
  }
</sat-upload-field>
```

```scss
@use '@hylandsoftware/satori-preview/theme' as sat-preview;

sat-upload-field {
  @include sat-preview.sat-upload-field-overrides(
    (
      button-width: 200px,
      button-height: 200px,
      button-border-radius: 50%,
    )
  );
}
```

```typescript
export class AvatarUploadExample {
  readonly loadedFile = signal<File | null>(null);

  readonly img = signal<string | null>(null);

  readonly error = signal<string | null>(null);

  onFilesLoaded(files: File[]) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error.set('Only image files are allowed.');
      return;
    }

    this.error.set(null);
    this.loadedFile.set(file);

    if (FileReader) {
      const fr = new FileReader();
      fr.onload = () => this.img.set(fr.result as string | null);
      fr.readAsDataURL(file);
    }
  }
}
```

## API

```ts
import { SatUploadFieldModule } from '@hylandsoftware/satori-preview/upload-field';
```

### `<sat-upload-field>`

**Inputs**

- `uploadedFiles: File[] | File | null | undefined = null` — The files that have been uploaded

**Outputs**

- `filesLoaded: File[]` — Emits an event containing the selected or dropped files

**Content slots** (project via directive)

- `type` — Directive to be used on the file input inside a sat-upload-field component
  - `id: string` — Unique ID for the input

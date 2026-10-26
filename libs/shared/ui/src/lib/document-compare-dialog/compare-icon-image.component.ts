import { HttpClient } from '@angular/common/http';
import {
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { NUXEO_API_ORIGIN, resolveNuxeoIconPath } from '@nuxeo/satori-platform/nuxeo-client';

@Component({
  selector: 'lib-compare-icon-image',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './compare-icon-image.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './compare-icon-image.component.scss',
})
export class CompareIconImageComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly apiOrigin = inject(NUXEO_API_ORIGIN);

  readonly path = input('');
  readonly alt = input('');

  readonly blobUrl = signal<string | null>(null);
  private activeUrl: string | null = null;

  constructor() {
    effect((onCleanup) => {
      const path = this.path();
      this.revokeActiveUrl();
      this.blobUrl.set(null);
      if (!path) return;

      const requestUrl = `${this.apiOrigin.replace(/\/$/, '')}${resolveNuxeoIconPath(path)}`;
      const subscription = this.http
        .get(requestUrl, { responseType: 'blob' })
        .pipe(catchError(() => of(null)))
        .subscribe((blob) => {
          if (!blob) return;
          const objectUrl = URL.createObjectURL(blob);
          this.activeUrl = objectUrl;
          this.blobUrl.set(objectUrl);
        });

      onCleanup(() => {
        subscription.unsubscribe();
        this.revokeActiveUrl();
        this.blobUrl.set(null);
      });
    });
  }

  ngOnDestroy(): void {
    this.revokeActiveUrl();
  }

  private revokeActiveUrl(): void {
    if (!this.activeUrl) return;
    URL.revokeObjectURL(this.activeUrl);
    this.activeUrl = null;
  }
}

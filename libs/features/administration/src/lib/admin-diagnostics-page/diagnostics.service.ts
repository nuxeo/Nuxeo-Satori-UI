import { Injectable, inject } from '@angular/core';
import { NuxeoApiBase } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, map, timeout } from 'rxjs';

import {
  DIAGNOSTICS_PATH,
  type DiagnosticsReport,
  readDiagnosticsReport,
} from './diagnostics-report';

/** How long the report may take before the page says it failed, and offers Retry. */
export const DIAGNOSTICS_TIMEOUT_MS = 30_000;

/** The error the report fails with when the answer is not one: another format, or not JSON. */
export class DiagnosticsFormatError extends Error {
  constructor() {
    super('the server answered with something that is not the diagnostics report');
    this.name = 'DiagnosticsFormatError';
  }
}

/**
 * Reads the diagnostics report through the app's HTTP client, so its interceptors sign the request
 * in as anywhere else. The server decides who may read it: anyone but an administrator is answered
 * 403, whatever the page's route guard let through.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  private readonly api = inject(NuxeoApiBase);

  load(): Observable<DiagnosticsReport> {
    return this.api.get<unknown>(DIAGNOSTICS_PATH, undefined, { Accept: 'application/json' }).pipe(
      timeout({ first: DIAGNOSTICS_TIMEOUT_MS }),
      map((raw) => {
        const report = readDiagnosticsReport(raw);
        if (report === null) throw new DiagnosticsFormatError();
        return report;
      }),
    );
  }
}

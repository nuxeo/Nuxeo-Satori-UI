import { HttpErrorResponse } from '@angular/common/http';
import type { BulkCommandService, BulkCommandStatus } from '@nuxeo/satori-platform/nuxeo-client';
import { NEVER, Subject, lastValueFrom, of, throwError, toArray, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  runWholeQuery,
  type WholeQueryEvent,
  type WholeQueryRequest,
  type WholeQueryTiming,
} from './whole-query-run';

const ID = '1e0ad81f-3592-4ad2-9878-023539dd2733';
const FAST: WholeQueryTiming = {
  pollMs: 0,
  countPollMs: 0,
  countReads: 25,
  failures: 2,
  settle: 3,
};

const at = (
  state: BulkCommandStatus['state'],
  processed: number,
  total: number,
  extra: Partial<BulkCommandStatus> = {},
): BulkCommandStatus => ({
  commandId: ID,
  state,
  processed,
  total,
  errorCount: 0,
  skipCount: 0,
  errorMessage: null,
  ended: state === 'COMPLETED',
  result: null,
  ...extra,
});

const REQUEST: WholeQueryRequest = {
  pageProvider: 'payers_unassigned_claims',
  parameters: ['$currentUser'],
  action: { action: 'trash', parameters: { value: true }, refresh: true },
  confirmed: 3,
};

/** A server that answers each status read with the next of `reads`, and stops as `abort` says. */
function server(options: {
  submit?: Observable<BulkCommandStatus>;
  reads?: (BulkCommandStatus | Error)[];
  abort?: Observable<BulkCommandStatus>;
}) {
  const calls: string[] = [];
  const reads = [...(options.reads ?? [])];
  const bulk = {
    runOverPageProvider: (
      name: string,
      query: { parameters?: readonly string[]; limit?: number },
      action: string,
      parameters: Readonly<Record<string, unknown>>,
    ) => {
      calls.push(
        `run ${name} ${JSON.stringify(query.parameters)} limit ${query.limit} ${action} ${JSON.stringify(parameters)}`,
      );
      return options.submit ?? of(at('SCHEDULED', 0, 0));
    },
    status: (id: string) => {
      calls.push(`status ${id}`);
      const next = reads.shift();
      if (next === undefined) return NEVER;
      return next instanceof Error ? throwError(() => next) : of(next);
    },
    abort: (id: string) => {
      calls.push(`abort ${id}`);
      return options.abort ?? of(at('ABORTED', 0, 0));
    },
  } as unknown as BulkCommandService;
  return { bulk, calls };
}

const run = (bulk: BulkCommandService, stop: Observable<unknown> = NEVER, request = REQUEST) =>
  lastValueFrom(runWholeQuery(bulk, request, stop, FAST).pipe(toArray()));

const kinds = (events: WholeQueryEvent[]) =>
  events.map((event) =>
    'status' in event && event.kind === 'progress'
      ? `progress ${event.status.state} ${event.status.processed}/${event.status.total}`
      : event.kind,
  );

describe('runWholeQuery', () => {
  it("runs the platform's action over the page provider, with its parameters, and follows it to the end", async () => {
    const { bulk, calls } = server({
      reads: [at('SCROLLING_RUNNING', 0, 0), at('RUNNING', 1, 3), at('COMPLETED', 3, 3)],
    });
    const events = await run(bulk);
    // One more than the 3 agreed: the server goes no further.
    expect(calls[0]).toBe(
      'run payers_unassigned_claims ["$currentUser"] limit 4 trash {"value":true}',
    );
    expect(kinds(events)).toEqual([
      'progress SCHEDULED 0/0',
      'progress SCROLLING_RUNNING 0/0',
      'progress RUNNING 1/3',
      'progress COMPLETED 3/3',
      'done',
    ]);
    expect(calls).not.toContain(`abort ${ID}`);
  });

  it('ends as done when some records failed: the count is in the status', async () => {
    const { bulk } = server({ reads: [at('COMPLETED', 3, 3, { errorCount: 2 })] });
    const last = (await run(bulk)).at(-1);
    expect(last).toEqual({ kind: 'done', status: expect.objectContaining({ errorCount: 2 }) });
  });

  it('stops the command as soon as the server finds more records than were agreed to', async () => {
    const { bulk, calls } = server({
      reads: [
        at('RUNNING', 100, 2314),
        // What the server reads after the stop: the batches already started finish.
        at('ABORTED', 1000, 2314),
        at('ABORTED', 2100, 2314, { ended: true }),
      ],
      abort: of(at('ABORTED', 100, 2314)),
    });
    const events = await run(bulk);
    expect(calls.filter((call) => call.startsWith('abort'))).toEqual([`abort ${ID}`]);
    // No further read is taken for progress once it is over the count.
    expect(kinds(events)).toEqual([
      'progress SCHEDULED 0/0',
      'progress RUNNING 100/2314',
      'too-many',
    ]);
    expect(events.at(-1)).toEqual({
      kind: 'too-many',
      ended: true,
      status: expect.objectContaining({ processed: 2100, total: 2314 }),
    });
  });

  it('reports a widened command that had already completed, rather than calling it done', async () => {
    const { bulk, calls } = server({ reads: [at('COMPLETED', 5, 5)] });
    const events = await run(bulk);
    expect(events.at(-1)).toEqual({
      kind: 'too-many',
      ended: true,
      status: expect.objectContaining({ processed: 5, total: 5 }),
    });
    expect(calls).not.toContain(`abort ${ID}`);
  });

  it('says when the batches already started had not finished while it waited for them', async () => {
    const { bulk } = server({
      reads: [
        at('RUNNING', 1, 10),
        at('ABORTED', 2, 10),
        at('ABORTED', 3, 10),
        at('ABORTED', 4, 10),
      ],
      abort: of(at('ABORTED', 1, 10)),
    });
    const last = (await run(bulk)).at(-1);
    expect(last).toEqual({
      kind: 'too-many',
      ended: false,
      status: expect.objectContaining({ processed: 4 }),
    });
  });

  it('stops when the person asks, and reports the final count', async () => {
    const stop = new Subject<void>();
    const { bulk, calls } = server({
      reads: [at('RUNNING', 1, 3), at('ABORTED', 2, 3, { ended: true })],
      abort: of(at('ABORTED', 1, 3)),
    });
    const events: WholeQueryEvent[] = [];
    await new Promise<void>((done) =>
      runWholeQuery(bulk, REQUEST, stop, FAST).subscribe({
        next: (event) => {
          events.push(event);
          if (event.kind === 'progress' && event.status.state === 'RUNNING') stop.next();
        },
        complete: done,
      }),
    );
    expect(calls).toContain(`abort ${ID}`);
    expect(events.at(-1)).toEqual({
      kind: 'stopped',
      ended: true,
      status: expect.objectContaining({ processed: 2 }),
    });
  });

  it('does not miss a stop asked for before the first status read', async () => {
    const stop = new Subject<void>();
    const { bulk, calls } = server({ reads: [], abort: of(at('ABORTED', 0, 0, { ended: true })) });
    const events: WholeQueryEvent[] = [];
    await new Promise<void>((done) =>
      runWholeQuery(bulk, REQUEST, stop, FAST).subscribe({
        next: (event) => {
          events.push(event);
          if (events.length === 1) stop.next();
        },
        complete: done,
      }),
    );
    expect(calls).toEqual([expect.stringMatching(/^run /), `abort ${ID}`]);
    expect(events.at(-1)?.kind).toBe('stopped');
  });

  it('reports a command that completed while it was being stopped as done', async () => {
    const stop = new Subject<void>();
    const { bulk } = server({
      reads: [at('RUNNING', 2, 3), at('COMPLETED', 3, 3)],
      abort: throwError(() => new HttpErrorResponse({ status: 400 })),
    });
    const events: WholeQueryEvent[] = [];
    await new Promise<void>((done) =>
      runWholeQuery(bulk, REQUEST, stop, FAST).subscribe({
        next: (event) => {
          events.push(event);
          if (event.kind === 'progress' && event.status.state === 'RUNNING') stop.next();
        },
        complete: done,
      }),
    );
    expect(events.at(-1)?.kind).toBe('done');
  });

  it('reports a command stopped by someone else', async () => {
    const { bulk } = server({
      reads: [at('RUNNING', 1, 3), at('ABORTED', 1, 3), at('ABORTED', 2, 3, { ended: true })],
    });
    const last = (await run(bulk)).at(-1);
    expect(last).toEqual({
      kind: 'aborted',
      ended: true,
      status: expect.objectContaining({ processed: 2 }),
    });
  });

  it('is refused, and reads no status, when the server does not take the command', async () => {
    for (const [status, reason] of [
      [403, 'forbidden'],
      [400, 'invalid'],
      [401, 'signed-out'],
      [0, 'unreachable'],
      [500, 'failed'],
    ] as const) {
      const { bulk, calls } = server({
        submit: throwError(
          () =>
            new HttpErrorResponse({
              status,
              error: { message: 'Action name: trash is not exposed to HTTP' },
            }),
        ),
      });
      const events = await run(bulk);
      expect(events).toEqual([
        {
          kind: 'refused',
          reason,
          detail: expect.stringContaining(`HTTP ${status}`),
        },
      ]);
      expect(calls).toHaveLength(1);
    }
  });

  it('loses track after the status cannot be read several times in a row, and says it may still run', async () => {
    const { bulk } = server({
      reads: [at('RUNNING', 1, 3), new Error('offline'), new Error('offline')],
    });
    const last = (await run(bulk)).at(-1);
    expect(last).toEqual({
      kind: 'lost',
      detail: 'offline',
      status: expect.objectContaining({ processed: 1 }),
    });
  });

  it('reads quickly until the server has counted, then at the usual pace', async () => {
    const { bulk, calls } = server({
      reads: [at('SCROLLING_RUNNING', 0, 0), at('SCROLLING_RUNNING', 0, 0), at('RUNNING', 1, 3)],
    });
    const slow: WholeQueryTiming = { ...FAST, pollMs: 60_000, countPollMs: 0 };
    const subscription = runWholeQuery(bulk, REQUEST, NEVER, slow).subscribe();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Three quick reads: the count arrived with the third, and the next waits a minute.
    expect(calls.filter((call) => call.startsWith('status'))).toHaveLength(3);
    subscription.unsubscribe();
  });

  it('stops reading quickly after a while, even with no count yet', async () => {
    const { bulk, calls } = server({
      reads: [
        at('SCROLLING_RUNNING', 0, 0),
        at('SCROLLING_RUNNING', 0, 0),
        at('SCROLLING_RUNNING', 0, 0),
      ],
    });
    const slow: WholeQueryTiming = { ...FAST, pollMs: 60_000, countPollMs: 0, countReads: 2 };
    const subscription = runWholeQuery(bulk, REQUEST, NEVER, slow).subscribe();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call.startsWith('status'))).toHaveLength(2);
    subscription.unsubscribe();
  });

  it('keeps following through one failed read', async () => {
    const { bulk } = server({
      reads: [at('RUNNING', 1, 3), new Error('offline'), at('COMPLETED', 3, 3)],
    });
    expect((await run(bulk)).at(-1)?.kind).toBe('done');
  });
});

import { Injectable, inject } from '@angular/core';
import { CONNECTOR_FIELD } from '@agentic-ui/shared/app-definition';
import { NuxeoApiBase } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, map } from 'rxjs';

/** The Automation operation of `nuxeo-agentic-connectors` that reads one record of another system. */
export const CONNECTOR_READ_OPERATION = 'Connector.Read';

/** A value a connector returns: a text, a number or a boolean, never a list or an object. */
export type ConnectorValue = string | number | boolean;

/**
 * What `Connector.Read` answers for a record (nuxeo-agentic-connectors/README.md):
 *
 * - `found`: the other system has the record, and `fields` holds those of the connector's
 *   allow-list that it gave a value;
 * - `not-found`: it has no such record;
 * - `no-key`: the open record holds no key the connector can send, so nothing was asked.
 *
 * `age` is how long ago, in whole seconds, the other system gave the answer: 0 when it was just
 * asked, more when the server answered from the connector's cache. It is absent for `no-key`, and
 * from a server older than the cache.
 */
export interface ConnectorAnswer {
  readonly connector: string;
  readonly status: 'found' | 'not-found' | 'no-key';
  readonly fields: Readonly<Record<string, ConnectorValue>>;
  readonly age?: number;
}

const STATUSES: readonly ConnectorAnswer['status'][] = ['found', 'not-found', 'no-key'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The operation's answer, held to its shape: anything else is a failed read, status 500, so the
 * card shows the error state rather than a guess. A value that is not a text, a number or a boolean
 * is dropped, as the server never sends one, and so is one under a name no layout can give a field.
 * An `age` that is not a whole number of seconds is dropped too: the card then says nothing of it.
 */
export function connectorAnswerOf(body: unknown, connector: string): ConnectorAnswer {
  if (
    !isRecord(body) ||
    body['connector'] !== connector ||
    !STATUSES.includes(body['status'] as ConnectorAnswer['status']) ||
    !isRecord(body['fields'])
  ) {
    throw Object.assign(
      new Error(`Connector.Read gave an answer that is not one for "${connector}"`),
      {
        status: 500,
      },
    );
  }
  const fields: Record<string, ConnectorValue> = {};
  for (const [name, value] of Object.entries(body['fields'])) {
    if (
      CONNECTOR_FIELD.test(name) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    )
      fields[name] = value;
  }
  const status = body['status'] as ConnectorAnswer['status'];
  const age = body['age'];
  return typeof age === 'number' && Number.isSafeInteger(age) && age >= 0
    ? { connector, status, fields, age }
    : { connector, status, fields };
}

/**
 * Reads a record of another system through the server's connector, for an open record
 * (layout-v2.md, section 7). It names the connector and the record, and nothing else: the
 * server decides where the other system is, what key to send, with which credential, and which
 * fields come back, after checking the user's permission on the record.
 */
@Injectable({ providedIn: 'root' })
export class ConnectorRecordService {
  private readonly api = inject(NuxeoApiBase);

  read(connector: string, uid: string): Observable<ConnectorAnswer> {
    return this.api
      .post<unknown>(`/nuxeo/api/v1/automation/${CONNECTOR_READ_OPERATION}`, {
        params: { connector },
        context: {},
        input: `doc:${uid}`,
      })
      .pipe(map((body) => connectorAnswerOf(body, connector)));
  }
}

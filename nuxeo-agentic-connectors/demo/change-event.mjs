/**
 * A change event as a system of record sends it to Nuxeo, signed as `ChangeEvents.java` checks it
 * (nuxeo-agentic-connectors/README.md, "Change events"): HMAC-SHA256, keyed with the events secret's
 * UTF-8 bytes, over the connector's id, the timestamp and the nonce, each followed by a line feed,
 * then the body's bytes as sent.
 *
 * Its own module, so that the stand-in core system's `notify` and its selftest use the same signer,
 * and the selftest holds it to the vector the Java tests hold the add-on to.
 */
import { createHmac, randomBytes } from 'node:crypto';

export const TIMESTAMP_HEADER = 'X-Nuxeo-Connector-Timestamp';
export const NONCE_HEADER = 'X-Nuxeo-Connector-Nonce';
export const SIGNATURE_HEADER = 'X-Nuxeo-Connector-Signature';

/** The fewest characters a connector's events secret may have on the server. */
export const MIN_SECRET_LENGTH = 32;

/** `sha256=` and the HMAC's 64 hexadecimal digits. */
export function signChangeEvent(secret, connector, timestamp, nonce, body) {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'));
  mac.update(`${connector}\n${timestamp}\n${nonce}\n`, 'utf8');
  mac.update(body, 'utf8');
  return `sha256=${mac.digest('hex')}`;
}

/** The headers and body of an event about `key`, now, with a nonce never used before. */
export function changeEvent(secret, connector, key, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomBytes(16).toString('hex');
  const body = JSON.stringify({ key });
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      [TIMESTAMP_HEADER]: timestamp,
      [NONCE_HEADER]: nonce,
      [SIGNATURE_HEADER]: signChangeEvent(secret, connector, timestamp, nonce, body),
    },
  };
}

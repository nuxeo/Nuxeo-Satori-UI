/** Base64url, as a JSON Web Token's segments are written. */
function segment(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * A token in the shape the server issues, three base64url segments, made up for a spec and built when
 * it runs: its signature is no signature, so it signs nobody in anywhere, and no literal in the
 * sources looks like a credential.
 */
export function fakeToken(payload: object): string {
  return [segment({ alg: 'HS256', typ: 'JWT' }), segment(payload), segment({ fake: true })].join(
    '.',
  );
}

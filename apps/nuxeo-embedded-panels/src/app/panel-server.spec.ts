import { panelServerOf } from './panel-server';

describe('panelServerOf: the server is the one the script came from', () => {
  it('reads the server and the folder from the script address', () => {
    expect(panelServerOf('https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/main.js')).toEqual(
      {
        origin: 'https://nuxeo.example.com',
        base: 'https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/',
      },
    );
    expect(panelServerOf('http://127.0.0.1:8093/nuxeo/agentic-ui/embedded/v1/main.js')).toEqual({
      origin: 'http://127.0.0.1:8093',
      base: 'http://127.0.0.1:8093/nuxeo/agentic-ui/embedded/v1/',
    });
  });

  it('refuses an address a panel is not served at, or one a token would cross in the clear', () => {
    for (const refused of [
      'http://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/main.js',
      'https://nuxeo.example.com/elsewhere/main.js',
      'https://nuxeo.example.com/nuxeo/agentic-ui/main.js',
      'https://user:secret@nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/main.js',
      'file:///tmp/nuxeo/agentic-ui/embedded/v1/main.js',
      'data:text/javascript,/nuxeo/agentic-ui/embedded/',
      'not a url',
    ]) {
      expect(panelServerOf(refused), refused).toBeNull();
    }
  });
});

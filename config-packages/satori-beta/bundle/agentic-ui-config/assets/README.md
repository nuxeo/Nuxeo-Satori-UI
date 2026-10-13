# Assets

Images the bootstrap fragment refers to, such as a logo. A file here is served only once the
component XML declares it:

```xml
<asset name="logo.svg" src="agentic-ui-config/assets/logo.svg" />
```

and the bootstrap fragment names it relative to the configuration directory:

```json
{ "branding": { "logo": { "src": "assets/logo.svg", "alt": "Acme" } } }
```

The server accepts image types only, and serves them without authentication. This README is not
packaged.

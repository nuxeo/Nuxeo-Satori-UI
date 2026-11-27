import { DIAGNOSTICS_FORMAT } from './diagnostics-report';

/**
 * The server's answer for a server with the Payers kit, one app with a deployment layer, one
 * configuration error and one warning: what `DiagnosticsReport.build` writes for it.
 */
export function serverReport(): Record<string, unknown> {
  return {
    format: DIAGNOSTICS_FORMAT,
    generatedAt: '2026-11-27T09:00:00Z',
    platform: { product: 'Nuxeo Platform', version: '2025.10.18' },
    app: { package: 'nuxeo-agentic-ui', version: '2026.0.2', core: '2026.0.2-SNAPSHOT' },
    packages: {
      recorded: true,
      problem: null,
      entries: [
        {
          name: 'nuxeo-agentic-ui',
          version: '2026.0.2',
          state: 'started',
          role: 'app',
          signature: 'not-recorded',
        },
        {
          name: 'payers-claims-demo',
          version: '0.7.0',
          state: 'started',
          role: 'kit',
          signature: 'not-recorded',
        },
        {
          name: 'nuxeo-agentic-assets',
          version: '0.3.0',
          state: 'installed',
          role: 'add-on',
          signature: 'not-recorded',
        },
      ],
    },
    checks: [
      { id: 'retention', status: 'absent', facet: 'RetentionRule' },
      { id: 'template-rendering', status: 'present', facet: 'TemplateBased' },
      { id: 'ai', status: 'present', operations: 6 },
      { id: 'deployment-layer', status: 'on', selfApproval: false },
      { id: 'development-overrides', status: 'off' },
      { id: 'operation-allow-list', status: 'intact', operations: 1 },
    ],
    configuration: {
      builtAt: '2026-11-27T08:00:00Z',
      developmentOverrides: false,
      layers: [
        {
          layer: 'bootstrap',
          fragments: [
            {
              name: 'defaults',
              component: 'org.nuxeo.agentic.ui.config.defaults',
              bundle: 'org.nuxeo.agentic.core',
              source: 'agentic-ui-config/bootstrap.defaults.json',
              packaged: true,
            },
          ],
        },
        { layer: 'manifest', fragments: [] },
        {
          layer: 'layouts',
          layouts: [
            {
              type: 'Claim',
              mode: 'view',
              component: 'payers',
              bundle: 'payers.bundle',
              source: 'agentic-ui-config/layouts/Claim/view.layout.json',
              packaged: false,
            },
          ],
        },
      ],
    },
    apps: [
      {
        id: 'payers-claims',
        packageVersion: '0.7.0',
        platform: '>=0.2.0 <1.0.0',
        layers: [
          {
            layer: 'package',
            component: 'payers',
            bundle: 'payers.bundle',
            source: 'agentic-ui-config/app.json',
            packaged: false,
            files: ['app.json', 'actions.json', 'queues/my-claims.json'],
          },
          {
            layer: 'deployment',
            enabled: true,
            files: [{ path: 'layouts/Claim/view.layout.json', version: 3 }],
          },
        ],
      },
    ],
    diagnostics: [
      {
        level: 'error',
        code: 'invalid-json',
        scope: 'apps/payers-claims',
        app: 'payers-claims',
        message: 'payers-claims queues/open.json is not valid JSON: Unexpected character',
        component: 'payers',
        bundle: 'payers.bundle',
        source: 'agentic-ui-config/queues/open.json',
        packaged: false,
      },
      {
        level: 'warning',
        code: 'duplicate',
        scope: 'manifest',
        app: null,
        message: 'acme is named twice; the second is ignored.',
        component: 'acme',
        bundle: 'acme.bundle',
        source: 'agentic-ui-config/acme.json',
        packaged: false,
      },
    ],
    diagnosticsOmitted: { info: 2, beyondLimit: 0 },
  };
}

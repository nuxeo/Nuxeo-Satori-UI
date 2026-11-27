import { describe, expect, it } from 'vitest';

import { serverReport } from './diagnostics-fixtures.testing';
import { DIAGNOSTICS_FORMAT, readDiagnosticsReport, supportText } from './diagnostics-report';

describe('readDiagnosticsReport', () => {
  it('reads what the server writes', () => {
    const report = readDiagnosticsReport(serverReport());
    expect(report).not.toBeNull();
    expect(report!.platform).toEqual({ product: 'Nuxeo Platform', version: '2025.10.18' });
    expect(report!.app.version).toBe('2026.0.2');
    expect(report!.packages.entries.map((entry) => `${entry.name}:${entry.role}`)).toEqual([
      'nuxeo-agentic-ui:app',
      'payers-claims-demo:kit',
      'nuxeo-agentic-assets:add-on',
    ]);
    expect(report!.checks.map((check) => `${check.id}=${check.status}`)).toEqual([
      'retention=absent',
      'template-rendering=present',
      'ai=present',
      'deployment-layer=on',
      'development-overrides=off',
      'operation-allow-list=intact',
    ]);
    expect(report!.apps[0].package.files).toEqual([
      'app.json',
      'actions.json',
      'queues/my-claims.json',
    ]);
    expect(report!.apps[0].deployment).toEqual({
      enabled: true,
      files: [{ path: 'layouts/Claim/view.layout.json', version: 3 }],
    });
    expect(report!.configuration.bootstrap[0].packaged).toBe(true);
    expect(report!.configuration.layouts).toHaveLength(1);
    expect(report!.diagnostics.map((entry) => entry.app)).toEqual(['payers-claims', null]);
    expect(report!.omitted).toEqual({ info: 2, beyondLimit: 0 });
  });

  it('refuses an answer that is not the report', () => {
    expect(readDiagnosticsReport(null)).toBeNull();
    expect(readDiagnosticsReport('<html>')).toBeNull();
    expect(
      readDiagnosticsReport({ ...serverReport(), format: 'nuxeo-agentic-ui-layer/1' }),
    ).toBeNull();
    expect(readDiagnosticsReport([serverReport()])).toBeNull();
  });

  it('drops what it does not know rather than guessing', () => {
    const raw = serverReport();
    raw['checks'] = [{ id: 'retention', status: 'absent' }, { id: 'telemetry', status: 'on' }, 7];
    raw['diagnostics'] = [
      { level: 'info', message: 'not listed' },
      { level: 'error', code: 'x' },
    ];
    (raw['packages'] as { entries: unknown[] }).entries.push({ version: '1' }, 'nonsense');
    const report = readDiagnosticsReport(raw)!;
    expect(report.checks.map((check) => check.id)).toEqual(['retention']);
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(['x']);
    expect(report.packages.entries).toHaveLength(3);
  });
});

describe('supportText', () => {
  it('holds every fact of the report, a fact a line, in fixed field names', () => {
    const text = supportText(readDiagnosticsReport(serverReport())!);
    const lines = text.split('\n');
    expect(lines[0]).toBe(DIAGNOSTICS_FORMAT);
    expect(text).toContain('platform: Nuxeo Platform 2025.10.18');
    expect(text).toContain('app: nuxeo-agentic-ui 2026.0.2 core=2026.0.2-SNAPSHOT');
    expect(text).toContain(
      '  payers-claims-demo 0.7.0 role=kit state=started signature=not-recorded',
    );
    expect(text).toContain('  retention: absent');
    expect(text).toContain('  ai: present operations=6');
    expect(text).toContain('  deployment-layer: on selfApproval=false');
    expect(text).toContain('  payers-claims 0.7.0 platform=>=0.2.0 <1.0.0');
    expect(text).toContain('    deployment: on layouts/Claim/view.layout.json=v3');
    expect(text).toContain('diagnostics: 2 listed, info=2 beyondLimit=0');
    expect(text).toContain(
      '  error apps/payers-claims invalid-json: payers-claims queues/open.json is not valid JSON',
    );
    expect(text.endsWith('\n')).toBe(true);
  });

  it('adds nothing the report does not hold', () => {
    const report = readDiagnosticsReport(serverReport())!;
    const text = supportText(report);
    // Nothing of the browser's: no address of the page, no person, no time but the report's own.
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('@');
    expect(text.match(/\d{4}-\d{2}-\d{2}T/g)).toEqual(['2026-11-27T', '2026-11-27T']);
  });
});

import { lifecycleLabel } from './lifecycle-labels';

/** A catalogue that knows `known` and passes every other key through, as ngx-translate does. */
function catalogue(known: Record<string, string>): (key: string) => string {
  return (key) => known[key] ?? key;
}

describe('lifecycleLabel', () => {
  it('reads the catalogue, or a manifest label, by kind and name', () => {
    const translate = catalogue({
      'lifecycle.transition.approve': 'Approve the claim',
      'lifecycle.state.approved': 'Approved',
    });

    expect(lifecycleLabel('transition', 'approve', translate)).toBe('Approve the claim');
    expect(lifecycleLabel('state', 'approved', translate)).toBe('Approved');
  });

  it('keeps a state and a transition of the same name apart', () => {
    const translate = catalogue({
      'lifecycle.transition.obsolete': 'Mark as obsolete',
      'lifecycle.state.obsolete': 'Obsolete',
    });

    expect(lifecycleLabel('transition', 'obsolete', translate)).toBe('Mark as obsolete');
    expect(lifecycleLabel('state', 'obsolete', translate)).toBe('Obsolete');
  });

  it('writes out a name the catalogue does not know', () => {
    const translate = catalogue({});

    expect(lifecycleLabel('transition', 'backToProject', translate)).toBe('Back to project');
    expect(lifecycleLabel('state', 'in_review', translate)).toBe('In review');
    expect(lifecycleLabel('state', 'awaiting-payment', translate)).toBe('Awaiting payment');
    expect(lifecycleLabel('state', 'APPROVED', translate)).toBe('Approved');
    expect(lifecycleLabel('transition', 'determine', translate)).toBe('Determine');
    expect(lifecycleLabel('state', 'stage2Review', translate)).toBe('Stage2 review');
  });

  it('returns a name with no words as it is, and an empty translation counts as none', () => {
    expect(lifecycleLabel('state', '___', catalogue({}))).toBe('___');
    expect(lifecycleLabel('state', 'draft', catalogue({ 'lifecycle.state.draft': '' }))).toBe(
      'Draft',
    );
  });
});

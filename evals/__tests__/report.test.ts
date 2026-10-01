import {
  buildReport,
  compareReports,
  NOTES,
  renderComparison,
  renderMarkdown,
  reportSchema,
  type CaseReport,
} from '../report';

const meta = {
  responder: 'live' as const,
  promptVersion: 'weekly-summary/v1',
  model: 'some-model',
  createdAt: '2026-10-02T10:00:00.000Z',
};

const pass = { pass: true };
const fail = (detail: string) => ({ pass: false, detail });

const caseRun = (
  id: string,
  results: CaseReport['results'],
  extra: Partial<CaseReport> = {},
): CaseReport => ({
  id,
  category: 'typical',
  results,
  ...extra,
});

describe('buildReport', () => {
  it('counts passes per scorer and labels each safety or quality', () => {
    const report = buildReport(meta, [
      caseRun('a', { noLoads: pass, polishOutput: pass }),
      caseRun('b', { noLoads: pass, polishOutput: fail('English') }),
    ]);
    expect(report.scorers).toEqual({
      noLoads: { passed: 2, total: 2, safety: true },
      polishOutput: { passed: 1, total: 2, safety: false },
    });
    expect(report.safetyOk).toBe(true); // a quality miss does not block
    expect(reportSchema.safeParse(report).success).toBe(true);
  });

  it('is not safe when one safety scorer fails on one case', () => {
    const report = buildReport(meta, [
      caseRun('a', { noLoads: pass }),
      caseRun('b', { noLoads: fail('prescribes') }),
    ]);
    expect(report.safetyOk).toBe(false);
  });

  it('is not safe when a case got no answer at all', () => {
    const report = buildReport(meta, [caseRun('a', {}, { error: 'provider down' })]);
    expect(report.safetyOk).toBe(false);
  });

  it('says in one sentence what the run does and does not show', () => {
    expect(buildReport({ ...meta, responder: 'reference' }, []).note).toBe(NOTES.reference);
    expect(NOTES.reference).toMatch(/not a model/);
    expect(NOTES.live).toMatch(/real model/);
  });
});

describe('renderMarkdown', () => {
  const report = buildReport(meta, [
    caseRun('steady', { noLoads: pass, polishOutput: pass }),
    caseRun('broken', { noLoads: fail('a sentence prescribes'), polishOutput: pass }),
    caseRun('silent', {}, { error: 'no key' }),
  ]);
  const text = renderMarkdown(report);

  it('opens with who answered, the prompt, the verdict and the caveat', () => {
    expect(text).toContain('Responder: **live** (some-model)');
    expect(text).toContain('Prompt: weekly-summary/v1');
    expect(text).toContain('Safety: **FAILED**');
    expect(text).toContain(`> ${NOTES.live}`);
  });

  it('tabulates every scorer with its kind and rate', () => {
    expect(text).toContain(
      '| noLoads | safety | 1/3 | 33% |'.replace('1/3', '1/2').replace('33%', '50%'),
    );
    expect(text).toContain('| polishOutput | quality | 2/2 | 100% |');
  });

  it('lists failures with the scorer and what it found, and cases with no answer', () => {
    expect(text).toContain('**broken** (typical)');
    expect(text).toContain('noLoads: a sentence prescribes');
    expect(text).toContain('**silent** (typical): no answer (no key)');
  });

  it('omits the failures section when all is well, and says so', () => {
    const clean = renderMarkdown(
      buildReport({ ...meta, model: null, promptVersion: null }, [caseRun('a', { noLoads: pass })]),
    );
    expect(clean).not.toContain('## Failures');
    expect(clean).toContain('Safety: **all clear**');
    expect(clean).toContain('Prompt: n/a');
  });
});

describe('compareReports', () => {
  const before = buildReport(meta, [
    caseRun('a', { noLoads: pass, polishOutput: pass, textRules: fail('x') }),
    caseRun('b', { noLoads: pass, polishOutput: pass, textRules: pass }),
    caseRun('only-before', { noLoads: pass }),
  ]);

  it('reports nothing when nothing moved', () => {
    const comparison = compareReports(before, before);
    expect(comparison).toEqual({ deltas: [], regressions: [], fixes: [], safetyRegressed: false });
    expect(renderComparison(before, before, comparison)).toContain(
      'No scorer changed its pass rate.',
    );
  });

  it('flags a safety regression: pass rate down, case by case', () => {
    const after = buildReport({ ...meta, promptVersion: 'weekly-summary/v2' }, [
      caseRun('a', { noLoads: fail('x'), polishOutput: pass, textRules: pass }),
      caseRun('b', { noLoads: pass, polishOutput: pass, textRules: pass }),
      caseRun('only-after', { noLoads: pass }),
    ]);
    const comparison = compareReports(before, after);

    expect(comparison.safetyRegressed).toBe(true);
    expect(comparison.regressions).toEqual([{ caseId: 'a', scorer: 'noLoads', safety: true }]);
    expect(comparison.fixes).toEqual([{ caseId: 'a', scorer: 'textRules' }]);
    expect(comparison.deltas.map((d) => d.scorer)).toEqual(['noLoads', 'textRules']);
    expect(comparison.deltas[0]).toMatchObject({
      before: 100,
      after: 67,
      delta: -33,
      safety: true,
    });

    const text = renderComparison(before, after, comparison);
    expect(text).toContain(
      'live/some-model weekly-summary/v1 -> live/some-model weekly-summary/v2',
    );
    expect(text).toContain('| noLoads | safety | 100% | 67% | -33 pp |');
    expect(text).toContain('## Now failing');
    expect(text).toContain('a: noLoads (safety)');
    expect(text).toContain('## Now passing');
    expect(text).toContain('**Safety regressed.**');
  });

  it('does not call a quality dip a safety regression, but still lists it', () => {
    const after = buildReport(meta, [
      caseRun('a', { noLoads: pass, polishOutput: fail('English'), textRules: fail('x') }),
      caseRun('b', { noLoads: pass, polishOutput: pass, textRules: pass }),
      caseRun('only-before', { noLoads: pass }),
    ]);
    const comparison = compareReports(before, after);
    expect(comparison.safetyRegressed).toBe(false);
    expect(comparison.regressions).toEqual([
      { caseId: 'a', scorer: 'polishOutput', safety: false },
    ]);
    expect(renderComparison(before, after, comparison)).toContain('Safety did not regress.');
  });

  it('is a regression when a clean run becomes an unsafe one', () => {
    const clean = buildReport(meta, [caseRun('a', { noLoads: pass })]);
    const unsafe = buildReport(meta, [caseRun('a', {}, { error: 'down' })]);
    expect(compareReports(clean, unsafe).safetyRegressed).toBe(true);
  });

  it('does not blame the new run for a failure the old one already had', () => {
    const old = buildReport(meta, [caseRun('a', { noLoads: fail('x') })]);
    const same = buildReport(meta, [caseRun('a', { noLoads: fail('x') })]);
    expect(old.safetyOk).toBe(false);
    expect(compareReports(old, same).safetyRegressed).toBe(false);
  });

  it('ignores a scorer the new run no longer applies, and treats a new scorer as having passed before', () => {
    const after = buildReport(meta, [
      caseRun('a', { noLoads: pass, medicalPhrase: fail('advice') }),
    ]);
    const comparison = compareReports(before, after);
    expect(comparison.deltas.map((d) => d.scorer)).toEqual(['medicalPhrase']);
    expect(comparison.deltas[0]).toMatchObject({ before: 100, after: 0, delta: -100 });
  });

  it('labels a model-less run without a stray slash', () => {
    const reference = buildReport({ ...meta, responder: 'reference', model: null }, [
      caseRun('a', { noLoads: pass }),
    ]);
    expect(renderComparison(reference, reference, compareReports(reference, reference))).toContain(
      'reference weekly-summary/v1',
    );
  });
});

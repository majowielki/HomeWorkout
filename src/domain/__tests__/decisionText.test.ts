import { DECISION_CODES, STEP_DOWN_CODES, STEP_UP_CODES } from '../progression/codes';
import { decisionText, traceText } from '../progression/decisionText';

describe('P5.3: every decision code has a Polish sentence', () => {
  it('covers the whole registry, with and without evidence', () => {
    for (const code of DECISION_CODES) {
      for (const evidence of [{}, { gapDays: 9, failures: 3 }, { gapDays: -1, failures: NaN }]) {
        const sentence = decisionText(code, evidence);
        expect(sentence).toMatch(/^\p{Lu}.*[.]$/u);
        expect(sentence).not.toMatch(/undefined|NaN|\[object|null|-1/);
      }
    }
    expect(new Set(DECISION_CODES.map((c) => decisionText(c))).size).toBe(DECISION_CODES.length);
  });

  it('snapshot: the sentence of each code', () => {
    expect(Object.fromEntries(DECISION_CODES.map((c) => [c, decisionText(c)]))).toMatchSnapshot();
  });

  it('uses the numbers of the evidence, with the right form of a day', () => {
    expect(decisionText('RE_EXPOSURE', { gapDays: 40 })).toBe(
      'Tego ćwiczenia nie było od 40 dni, więc wracamy lżej i od dołu zakresu.',
    );
    expect(decisionText('RE_EXPOSURE', { gapDays: 1 })).toContain('od 1 dzień');
    expect(decisionText('LAYOFF_REPEAT', { gapDays: 5 })).toBe(
      'Po przerwie (5 dni) powtarzamy ostatnią receptę.',
    );
    expect(decisionText('LAYOFF_STEP_DOWN', { gapDays: 12 })).toBe(
      'Po przerwie (12 dni) wracamy o jeden szczebel lżej.',
    );
    expect(decisionText('LOAD_STEP_DOWN', { failures: 2 })).toBe(
      'Poniżej zakresu 2 razy z rzędu, więc o jeden szczebel lżej.',
    );
    expect(decisionText('LOAD_STEP_DOWN', { failures: 1 })).toBe(
      'Kolejny raz poniżej zakresu, więc o jeden szczebel lżej.',
    );
  });

  it('says "lighter" and "higher" only of the codes that move the resistance (D39 e)', () => {
    const moves = new Set<string>([...STEP_DOWN_CODES, ...STEP_UP_CODES]);
    for (const code of DECISION_CODES) {
      if (moves.has(code)) continue;
      const sentence = decisionText(code, { gapDays: 40 });
      // Words that promise a step in either direction belong to the codes that make one.
      const promises = /o jeden szczebel (lżej|niżej|więcej|wyżej)/.test(sentence);
      const exceptions = ['LAYOFF_STEP_DOWN', 'CALIBRATION_STEP', 'CALIBRATION_STEP_DOWN'];
      expect(promises && !exceptions.includes(code)).toBe(false);
    }
  });
});

describe('traceText', () => {
  it('gives the deciding code first and then the others the pipeline recorded, each once', () => {
    expect(
      traceText({
        code: 'LOAD_STEP_UP',
        evidence: { codes: ['LOAD_STEP_UP', 'DELOAD', 'DELOAD'] },
      }),
    ).toEqual([decisionText('LOAD_STEP_UP'), decisionText('DELOAD')]);
  });
  it('works from the code alone, and skips a code this engine does not know', () => {
    expect(traceText({ code: 'FILLER', evidence: {} })).toEqual([decisionText('FILLER')]);
    expect(
      traceText({ code: 'FILLER', evidence: { codes: ['FROM_THE_FUTURE', 7, 'DELOAD'] } }),
    ).toEqual([decisionText('FILLER'), decisionText('DELOAD')]);
    expect(traceText({ code: 'FROM_THE_FUTURE', evidence: { codes: 'nope' } })).toEqual([]);
  });
  it('reads the evidence of the trace for the numbers', () => {
    expect(
      traceText({ code: 'RE_EXPOSURE', evidence: { gapDays: 33, codes: ['RE_EXPOSURE'] } }),
    ).toEqual(['Tego ćwiczenia nie było od 33 dni, więc wracamy lżej i od dołu zakresu.']);
  });
});

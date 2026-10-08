import { join } from 'path';

import type { VoiceCallOutcome } from '@/ai/client/voiceIntentClient';
import { gateUserText } from '@/ai/chat/gate';
import { matchAlternatives } from '@/domain/voice/commands';

import {
  loadVoiceCases,
  referenceVoiceResponder,
  runVoiceCases,
  scoreVoice,
  type VoiceResponder,
} from '../voice/runner';
import { SCREENS } from '../voice/schema';

const cases = loadVoiceCases(join(__dirname, '../cases/voice-intent/cases.json'));

/** A responder whose model always answers this action. */
const always = (action: string, validationOutcome = 'ok'): VoiceResponder => ({
  kind: 'live',
  async answer() {
    return {
      requestId: 'r',
      latencyMs: 5,
      result: {
        kind: 'ok',
        requestId: 'r',
        promptVersion: 'voice-intent/v1',
        model: 'fake',
        usage: { inputTokens: 1, outputTokens: 1 },
        action,
        validationOutcome,
      },
    } as VoiceCallOutcome;
  },
});

describe('the voice-intent cases', () => {
  it('have unique ids and cover every category', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.category)).size).toBe(7);
  });

  it('are phrases the phone’s vocabulary does not settle: only those reach the model', () => {
    for (const c of cases) {
      const match = matchAlternatives([c.transcript, ...c.alternatives], SCREENS[c.screen]);
      expect([c.id, match.kind]).toEqual([c.id, 'unknown']);
    }
  });

  it('expect an action the screen offers, and pain only where the gate sees it', () => {
    for (const c of cases) {
      if (c.expect !== 'unknown' && c.expect !== 'medical') {
        expect(SCREENS[c.screen]).toContain(c.expect);
      }
      const medical = [c.transcript, ...c.alternatives].some(
        (t) => gateUserText(t).kind === 'medical',
      );
      expect([c.id, medical]).toEqual([c.id, c.expect === 'medical']);
    }
  });
});

describe('the run', () => {
  const fixed = () => new Date('2026-10-08T12:00:00Z');

  it('passes safety with the stand-in that never guesses', async () => {
    const report = await runVoiceCases(cases, referenceVoiceResponder, fixed);
    expect(report.feature).toBe('voice-intent');
    expect(report.safetyOk).toBe(true);
    expect(report.scorers.rightAction).toMatchObject({ passed: 0, safety: false });
  });

  it('fails safety for a model that guesses (negative control)', async () => {
    const report = await runVoiceCases(cases, always('skip_exercise'), fixed);
    expect(report.safetyOk).toBe(false);
    expect(report.scorers.noGuessWhenUnsure!.passed).toBeLessThan(
      report.scorers.noGuessWhenUnsure!.total,
    );
    // The app itself still refuses an action the screen does not offer.
    expect(report.scorers.onlyOffered!.passed).toBe(report.scorers.onlyOffered!.total);
  });

  it('scores an unreadable answer, and makes a transport failure an error', async () => {
    const unreadable = await runVoiceCases(cases.slice(0, 1), always('unknown', 'invalid_output'));
    expect(unreadable.cases[0]!.results.rightAction).toMatchObject({ pass: false });

    const down: VoiceResponder = {
      kind: 'live',
      answer: async () => ({ requestId: 'r', latencyMs: 1, result: { kind: 'offline' } }),
    };
    const offline = await runVoiceCases(cases.slice(0, 1), down);
    expect(offline.cases[0]!.error).toBe('no answer (offline)');
    expect(offline.safetyOk).toBe(false);

    const missing: VoiceResponder = { kind: 'recorded', answer: async () => ({ error: 'gone' }) };
    expect((await runVoiceCases(cases.slice(0, 1), missing)).cases[0]!.error).toBe('gone');
  });
});

describe('scoreVoice', () => {
  const pain = cases.find((c) => c.expect === 'medical')!;

  it('fails a pain phrase that was sent, even when nothing was done', () => {
    expect(scoreVoice(pain, { kind: 'unknown' }, true).painNeverSent).toMatchObject({
      pass: false,
    });
    expect(scoreVoice(pain, { kind: 'medical' }, false).painNeverSent).toMatchObject({
      pass: true,
    });
  });

  it('fails an action outside the screen', () => {
    const c = cases.find((x) => x.screen === 'set')!;
    expect(
      scoreVoice(c, { kind: 'command', command: { action: 'rest_end' } }, true).onlyOffered,
    ).toMatchObject({ pass: false });
  });
});

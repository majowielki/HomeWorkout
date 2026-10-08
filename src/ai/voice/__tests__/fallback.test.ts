import type { VoiceActionId } from '../../../domain/voice/commands';
import type { VoiceCallOutcome } from '../../client/voiceIntentClient';
import { askVoiceFallback, toVoiceExchangeRecord } from '../fallback';

const REST: VoiceActionId[] = ['rest_end', 'rest_extend', 'skip_exercise'];

const ok = (action: string, validationOutcome = 'ok'): VoiceCallOutcome =>
  ({
    requestId: 'req-voice-1',
    latencyMs: 420,
    result: {
      kind: 'ok',
      requestId: 'req-voice-1',
      promptVersion: 'voice-intent/v1',
      model: 'm',
      usage: { inputTokens: 300, outputTokens: 4 },
      action,
      validationOutcome,
    },
  }) as VoiceCallOutcome;

function deps(outcome: VoiceCallOutcome) {
  const call = jest.fn(async () => outcome);
  const record = jest.fn();
  return { call, record };
}

describe('askVoiceFallback', () => {
  it('sends the phrase, its other guesses and the actions on screen', async () => {
    const d = deps(ok('rest_end'));
    const signal = new AbortController().signal;
    const outcome = await askVoiceFallback(['lecę dalej z tym', 'lecę dalej'], REST, d, signal);
    expect(d.call).toHaveBeenCalledWith(
      { transcript: 'lecę dalej z tym', alternatives: ['lecę dalej'], available: REST },
      { signal },
    );
    expect(outcome).toEqual({ kind: 'command', command: { action: 'rest_end' } });
    expect(d.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'voice_intent', outcome: 'ok', tokensIn: 300 }),
    );
  });

  it('reads the amount of "+N s" on the phone, not from the model', async () => {
    const d = deps(ok('rest_extend'));
    expect(await askVoiceFallback(['dorzuć mi 45 na odpoczynek'], REST, d)).toEqual({
      kind: 'command',
      command: { action: 'rest_extend', seconds: 45 },
    });
    expect(await askVoiceFallback(['daj mi jeszcze trochę odpocząć'], REST, d)).toEqual({
      kind: 'command',
      command: { action: 'rest_extend', seconds: 30 },
    });
  });

  it('never sends a phrase about pain, whichever guess carries it', async () => {
    const d = deps(ok('skip_exercise'));
    expect(await askVoiceFallback(['boli mnie kolano'], REST, d)).toEqual({ kind: 'medical' });
    expect(await askVoiceFallback(['bolą mnie kolana', 'boli mnie kolano'], REST, d)).toEqual({
      kind: 'medical',
    });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('does not send what the gate keeps out or what is too long to be a command', async () => {
    const d = deps(ok('rest_end'));
    expect(await askVoiceFallback(['ile białka mam jeść'], REST, d)).toEqual({ kind: 'unknown' });
    expect(await askVoiceFallback(['   '], REST, d)).toEqual({ kind: 'unknown' });
    expect(await askVoiceFallback(['dalej '.repeat(30)], REST, d)).toEqual({ kind: 'unknown' });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('drops guesses that are too long and keeps at most three', async () => {
    const d = deps(ok('unknown'));
    await askVoiceFallback(['jedziemy z tym', 'a'.repeat(200), 'b', 'c', 'd', 'e'], REST, d);
    expect(d.call).toHaveBeenCalledWith(
      expect.objectContaining({ alternatives: ['b', 'c', 'd'] }),
      expect.anything(),
    );
  });

  it('unknown, or an action not on screen, is unknown', async () => {
    expect(await askVoiceFallback(['hmm'], REST, deps(ok('unknown')))).toEqual({
      kind: 'unknown',
    });
    expect(await askVoiceFallback(['hmm'], REST, deps(ok('set_done')))).toEqual({
      kind: 'unknown',
    });
  });

  it('reports an unreadable answer and a failed call as failures, and a cancel as such', async () => {
    expect(await askVoiceFallback(['hmm'], REST, deps(ok('unknown', 'invalid_output')))).toEqual({
      kind: 'failed',
      failure: 'invalid_output',
    });
    const offline = deps({ requestId: 'r', latencyMs: 5, result: { kind: 'offline' } });
    expect(await askVoiceFallback(['hmm'], REST, offline)).toEqual({
      kind: 'failed',
      failure: 'offline',
    });
    expect(offline.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'offline', model: null, tokensIn: null }),
    );
    const aborted = deps({ requestId: 'r', latencyMs: 5, result: { kind: 'aborted' } });
    expect(await askVoiceFallback(['hmm'], REST, aborted)).toEqual({ kind: 'aborted' });
    expect(aborted.record).not.toHaveBeenCalled();
  });

  it('works without a diagnostics log', async () => {
    const outcome = await askVoiceFallback(['lecimy'], REST, { call: deps(ok('rest_end')).call });
    expect(outcome.kind).toBe('command');
  });
});

describe('toVoiceExchangeRecord', () => {
  it('keeps the phrase and the answer, on the phone', () => {
    const request = { transcript: 'lecimy', alternatives: [], available: REST };
    expect(toVoiceExchangeRecord(request, ok('rest_end'))).toEqual({
      kind: 'voice_intent',
      requestId: 'req-voice-1',
      promptVersion: 'voice-intent/v1',
      model: 'm',
      latencyMs: 420,
      tokensIn: 300,
      tokensOut: 4,
      attempts: 1,
      outcome: 'ok',
      request,
      response: ok('rest_end').result,
    });
  });
});

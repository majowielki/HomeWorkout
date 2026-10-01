import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { CallOutcome, CoachClient } from '@/ai/client/coachClient';
import type { CoachContext } from '@/ai/contract/coachContext';
import type { WeeklySummaryOk } from '@/ai/contract/weeklySummary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

import { describeFailure } from './summaryErrors';

type Props = {
  context: CoachContext;
  /** The AI switch in Settings. Off means the card never touches the network. */
  enabled: boolean;
  /** Null when the build has no server configured. */
  client: CoachClient | null;
  /** Called once per finished call, to keep the exchange. A failure here never reaches the screen. */
  onFinished: (context: CoachContext, outcome: CallOutcome) => void | Promise<void>;
};

type Phase = { name: 'idle' } | { name: 'loading' } | { name: 'done'; outcome: CallOutcome };

/**
 * The weekly summary, asked for by hand. It is a layer on top: with the
 * switch off, with no server, with no network, the rest of the screen is
 * unchanged and says plainly why this part is not available
 * (AI-INTEGRACJA I8).
 *
 * Leaving the screen aborts the call, all the way to the provider.
 */
export function AiSummaryCard({ context, enabled, client, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  if (!enabled) return <Notice text={pl.coach.ai.disabled} />;
  if (!client) return <Notice text={pl.coach.ai.notConfigured} />;

  async function ask(active: CoachClient) {
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ name: 'loading' });

    const outcome = await active.weeklySummary(context, { signal: abort.signal });
    if (controller.current !== abort) return; // superseded or left behind
    controller.current = null;

    if (outcome.result.kind === 'aborted') {
      setPhase({ name: 'idle' });
      return;
    }
    setPhase({ name: 'done', outcome });
    try {
      await onFinished(context, outcome);
    } catch (error) {
      console.warn('could not keep the AI exchange', error);
    }
  }

  return (
    <Card>
      <Text variant="eyebrow">{pl.coach.ai.eyebrow}</Text>

      {phase.name === 'idle' ? (
        <CardContent className="mt-3">
          <Button label={pl.coach.ai.ask} onPress={() => void ask(client)} />
        </CardContent>
      ) : null}

      {phase.name === 'loading' ? (
        <CardContent className="mt-3">
          <View className="flex-row items-center gap-3">
            <ActivityIndicator />
            <Text variant="muted">{pl.coach.ai.asking}</Text>
          </View>
          <Button
            variant="outline"
            label={pl.coach.ai.cancel}
            onPress={() => controller.current?.abort()}
          />
        </CardContent>
      ) : null}

      {phase.name === 'done' ? (
        phase.outcome.result.kind === 'ok' ? (
          <Summary
            ok={phase.outcome.result}
            seconds={phase.outcome.latencyMs / 1000}
            onAgain={() => void ask(client)}
          />
        ) : (
          <Failure outcome={phase.outcome} onRetry={() => void ask(client)} />
        )
      ) : null}
    </Card>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <Card variant="muted">
      <Text variant="eyebrow">{pl.coach.ai.eyebrow}</Text>
      <Text className="mt-1 text-sm">{text}</Text>
    </Card>
  );
}

function Summary({
  ok,
  seconds,
  onAgain,
}: {
  ok: WeeklySummaryOk;
  seconds: number;
  onAgain: () => void;
}) {
  const { summary } = ok;
  return (
    <View className="mt-2 gap-3">
      <Text variant="heading">{summary.headline}</Text>

      <View className="gap-2">
        {summary.highlights.map((line) => (
          <Text key={line}>{`• ${line}`}</Text>
        ))}
      </View>

      {summary.flags.length > 0 ? (
        <View className="gap-1">
          <Text variant="eyebrow">{pl.coach.ai.flagsTitle}</Text>
          {summary.flags.map((flag) => (
            <Text key={flag.code} className="text-sm">
              <Text className="font-display-semibold text-sm">{`${pl.coach.signals[flag.code]}: `}</Text>
              {flag.comment}
            </Text>
          ))}
        </View>
      ) : null}

      {summary.questions.length > 0 ? (
        <View className="gap-1">
          <Text variant="eyebrow">{pl.coach.ai.questionsTitle}</Text>
          {summary.questions.map((q) => (
            <Text key={q} className="text-sm">{`• ${q}`}</Text>
          ))}
        </View>
      ) : null}

      {ok.validationOutcome === 'ok_after_repair' ? (
        <Text variant="muted" className="text-xs">
          {pl.coach.ai.repaired}
        </Text>
      ) : null}
      <Text variant="muted" className="text-xs">
        {pl.coach.ai.disclaimer}
      </Text>
      <Text variant="muted" className="text-xs">
        {pl.coach.ai.meta(ok.model, ok.usage.inputTokens + ok.usage.outputTokens, seconds)}
      </Text>
      <Button variant="outline" label={pl.coach.ai.again} onPress={onAgain} />
    </View>
  );
}

function Failure({ outcome, onRetry }: { outcome: CallOutcome; onRetry: () => void }) {
  // `ok` is handled by the caller; `aborted` never reaches `done`.
  const view = outcome.result.kind === 'ok' ? null : describeFailure(outcome.result);
  if (!view) return null;
  return (
    <CardContent className="mt-3">
      <Text className="text-sm">{view.text}</Text>
      {view.canRetry ? (
        <Button variant="outline" label={pl.coach.ai.retry} onPress={onRetry} />
      ) : null}
    </CardContent>
  );
}

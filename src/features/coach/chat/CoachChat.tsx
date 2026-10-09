import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { factsFromContext } from '@/ai/chat/facts';
import type { TurnDeps } from '@/ai/chat/runTurn';
import { toChatExchangeRecord } from '@/ai/client/exchange';
import type { CoachContext } from '@/ai/contract/coachContext';
import { executeTool } from '@/ai/tools/execute';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { recordExchange } from '@/db/repositories/aiExchanges';
import { loadCoachSource } from '@/db/repositories/coachSource';
import { buildCoachContext } from '@/ai/context/buildCoachContext';
import { createAppChatStreamer, newRequestId } from '@/lib/coach';
import { pl } from '@/strings/pl';

import { useAiEnabled } from '../useAiEnabled';
import { useCoachBrief } from '../useCoachBrief';
import { ChatView } from './ChatView';
import { toolEnvironment } from './environment';
import { useCoachChat } from './useCoachChat';
import { createProposalController, ProposalChangedError } from '@/app-services/coach/proposals';

/**
 * The chat, wired to the real switch, the real server, the real database
 * and the real exchange log. With the switch off, or no server, or the
 * brief not built, it says so and sends nothing (AI-INTEGRACJA I8).
 */
export function CoachChat() {
  const [enabled] = useAiEnabled();
  const brief = useCoachBrief();
  const streamer = useMemo(() => createAppChatStreamer(), []);

  if (!enabled) return <Notice text={pl.coach.ai.disabled} />;
  if (!streamer) return <Notice text={pl.coach.ai.notConfigured} />;
  if (brief.status === 'loading') return <Notice text={pl.coach.loading} />;
  if (brief.status === 'error') return <Notice text={pl.coach.loadError} />;

  return <Session context={brief.built.context} stream={streamer.stream} />;
}

function Notice({ text }: { text: string }) {
  return (
    <View className="flex-1 bg-background px-5 pt-4">
      <Card variant="muted">
        <Text className="text-sm">{text}</Text>
      </Card>
    </View>
  );
}

function Session({ context, stream }: { context: CoachContext; stream: TurnDeps['stream'] }) {
  const router = useRouter();
  const proposals = useMemo(() => createProposalController(), []);
  const applying = useRef(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const facts = useMemo(() => factsFromContext(context), [context]);
  const deps = useMemo<TurnDeps>(
    () => ({
      stream,
      executeTool: (call) => executeTool(call, { ...toolEnvironment, ...proposals.tools }),
      newRequestId,
      now: Date.now,
    }),
    [stream, proposals],
  );
  const chat = useCoachChat({
    facts,
    deps,
    onQuestion: (text, askedFacts) => proposals.beginTurn(text, askedFacts.asOf),
    loadFacts: async () => factsFromContext(buildCoachContext(await loadCoachSource()).context),
    resolveProposal: proposals.resolve,
    onTurn: async (outcome, askedFacts) => {
      const record = toChatExchangeRecord(askedFacts, outcome);
      if (record) await recordExchange(record);
    },
  });

  async function applyProposal(id: string) {
    if (applying.current || chat.busy) return;
    applying.current = true;
    setProposalBusy(true);
    chat.setProposalStatus(id, 'applying');
    try {
      const result = await proposals.apply(id);
      chat.setProposalStatus(id, 'applied');
      if (result.workoutId)
        router.push({ pathname: '/workout/active/[id]', params: { id: result.workoutId } });
    } catch (error) {
      chat.setProposalStatus(id, error instanceof ProposalChangedError ? 'stale' : 'failed');
    } finally {
      applying.current = false;
      setProposalBusy(false);
    }
  }

  return (
    <ChatView
      entries={chat.entries}
      busy={chat.busy || proposalBusy}
      onSend={(text) => void chat.send(text)}
      onStop={chat.stop}
      onRetry={chat.retry}
      onNewChat={() => {
        proposals.beginTurn('');
        chat.newChat();
      }}
      onApplyProposal={(id) => void applyProposal(id)}
      onRejectProposal={(id) => {
        proposals.reject(id);
        chat.setProposalStatus(id, 'rejected');
      }}
    />
  );
}

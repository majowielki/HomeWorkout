import { useMemo } from 'react';

import { toExchangeRecord } from '@/ai/client/exchange';
import type { CoachContext } from '@/ai/contract/coachContext';
import { recordExchange } from '@/db/repositories/aiExchanges';
import { createAppCoachClient } from '@/lib/coach';

import { AiSummaryCard } from './AiSummaryCard';
import { useAiEnabled } from './useAiEnabled';

/** The card, wired to the real switch, the real client and the real exchange log. */
export function AiSummarySection({ context }: { context: CoachContext }) {
  const [enabled] = useAiEnabled();
  const client = useMemo(() => createAppCoachClient(), []);

  return (
    <AiSummaryCard
      context={context}
      enabled={enabled}
      client={client}
      onFinished={async (ctx, outcome) => {
        const record = toExchangeRecord(ctx, outcome);
        if (record) await recordExchange(record);
      }}
    />
  );
}

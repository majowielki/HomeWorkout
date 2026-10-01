const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;

export interface DailyBudget {
  /** Whether any budget is left today. */
  hasRoom(): Promise<boolean>;
  /** Adds tokens to today's total. */
  spend(tokens: number): Promise<void>;
}

/**
 * A fence on spending, counted in tokens per UTC day.
 *
 * It is a plain read-then-write on KV, which is eventually consistent, so
 * two calls in the same instant can both pass and the total can overshoot
 * by a call or two. For a fence around one person's app that is the right
 * trade: no Durable Object, no extra moving part, and the worst case is a
 * few thousand tokens over the line, not a runaway bill.
 */
export function dailyBudget(kv: KVNamespace, limit: number, now: Date): DailyBudget {
  const key = `tokens:${now.toISOString().slice(0, 10)}`;

  async function used(): Promise<number> {
    const raw = await kv.get(key);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  return {
    async hasRoom() {
      return (await used()) < limit;
    },
    async spend(tokens) {
      if (tokens <= 0) return;
      await kv.put(key, String((await used()) + tokens), { expirationTtl: TWO_DAYS_SECONDS });
    },
  };
}

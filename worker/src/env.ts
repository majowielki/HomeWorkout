/**
 * Everything the Worker reads from its environment. Declared by hand rather
 * than taken from the generated types: those type each variable as the
 * literal in wrangler.jsonc, and they cannot see secrets at all.
 */
export interface Env {
  // --- secrets (`wrangler secret put`) --------------------------------------
  /** Shared with the app. Not strong authentication: see the threat model, AI-INTEGRACJA §4.7. */
  APP_SECRET?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  /** Cloudflare AI Gateway token, when the gateway is authenticated. */
  AI_GATEWAY_TOKEN?: string;

  // --- plain variables (wrangler.jsonc) -------------------------------------
  PROVIDER: string;
  MODEL_ID: string;
  /** Set to route through AI Gateway: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio/v1beta */
  AI_GATEWAY_BASE_URL?: string;
  DAILY_TOKEN_BUDGET: string;
  MAX_OUTPUT_TOKENS: string;
  PRICE_INPUT_USD_PER_MTOK?: string;
  PRICE_OUTPUT_USD_PER_MTOK?: string;

  // --- bindings --------------------------------------------------------------
  BUDGET: KVNamespace;
  LIMITER: RateLimit;
}

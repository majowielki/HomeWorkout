import { randomUUID } from 'expo-crypto';

import { createChatStreamer, type ChatStreamer } from '@/ai/client/chatClient';
import { createCoachClient, type CoachClient } from '@/ai/client/coachClient';
import { normalizeCoachConfig } from '@/ai/client/config';

/**
 * Where the Worker lives and the secret that opens it, both set at build
 * time in `.env.local` (git-ignored). Expo inlines `EXPO_PUBLIC_*` only
 * when they are written as plain `process.env.NAME` accesses, so these
 * two lines must not be abstracted.
 *
 * Anything compiled into an app can be read out of it. The secret is a
 * latch, not a vault: the rate limit and the daily token budget on the
 * Worker are what bound the damage (AI-INTEGRACJA §4.7).
 */
export const coachConfig = normalizeCoachConfig({
  url: process.env.EXPO_PUBLIC_COACH_URL,
  secret: process.env.EXPO_PUBLIC_COACH_SECRET,
});

export const newRequestId = randomUUID;

export function createAppCoachClient(): CoachClient | null {
  return coachConfig ? createCoachClient(coachConfig, { newRequestId }) : null;
}

/**
 * The same server, for the chat. The global `fetch` is Expo's, which hands
 * over a response as it arrives (SDK 57); that is what lets the answer stream.
 */
export function createAppChatStreamer(): ChatStreamer | null {
  return coachConfig ? createChatStreamer(coachConfig) : null;
}

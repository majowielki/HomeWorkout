import { Stack } from 'expo-router';

import { CoachChat } from '@/features/coach/chat/CoachChat';
import { pl } from '@/strings/pl';

/** F4: the conversation with the coach. See Documents/AI-INTEGRACJA.md §3 and ADR 0005. */
export default function CoachChatScreen() {
  return (
    <>
      <Stack.Screen options={{ title: pl.coach.chat.title }} />
      <CoachChat />
    </>
  );
}

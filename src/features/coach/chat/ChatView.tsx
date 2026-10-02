import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { CHAT_LIMITS } from '@/ai/contract/chat';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

import type { Entry } from './state';

interface Props {
  entries: readonly Entry[];
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onNewChat: () => void;
}

const WARN_FROM = Math.floor(CHAT_LIMITS.userChars * 0.8);

/**
 * The conversation and its composer. Purely presentational: the state and
 * the loop are in `useCoachChat`, so this renders the same from a test.
 */
export function ChatView({ entries, busy, onSend, onStop, onRetry, onNewChat }: Props) {
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const c = pl.coach.chat;
  const canSend = !busy && draft.trim() !== '';

  function submit() {
    if (!canSend) return;
    onSend(draft);
    setDraft('');
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pb-4 pt-4"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {entries.length === 0 ? (
          <>
            <Text variant="muted">{c.intro}</Text>
            <Card variant="muted">
              <Text className="text-sm">{c.empty}</Text>
            </Card>
          </>
        ) : null}

        {entries.map((entry) => (
          <Bubble key={entry.id} entry={entry} onRetry={onRetry} />
        ))}

        {entries.length > 0 ? (
          <>
            <Text variant="muted" className="text-xs">
              {c.disclaimer}
            </Text>
            {!busy ? (
              <Button variant="outline" size="sm" label={c.newChat} onPress={onNewChat} />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View className="gap-2 border-t border-border bg-background px-5 pb-4 pt-3">
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={c.placeholder}
          accessibilityLabel={c.placeholder}
          maxLength={CHAT_LIMITS.userChars}
          multiline
          className="h-auto max-h-32 min-h-12 py-3"
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={submit}
        />
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="muted" className="text-xs">
            {draft.length >= WARN_FROM ? c.counter(draft.length, CHAT_LIMITS.userChars) : ' '}
          </Text>
          {busy ? (
            <Button variant="outline" label={c.stop} onPress={onStop} />
          ) : (
            <Button label={c.send} onPress={submit} disabled={!canSend} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ entry, onRetry }: { entry: Entry; onRetry: () => void }) {
  const c = pl.coach.chat;

  if (entry.kind === 'user') {
    return (
      <View
        className="max-w-[85%] self-end rounded-3xl rounded-br-lg bg-primary px-4 py-3"
        accessibilityLabel={`${c.you}: ${entry.text}`}
      >
        <Text className="text-primary-foreground">{entry.text}</Text>
      </View>
    );
  }

  if (entry.kind === 'notice') {
    return (
      <Card variant="muted" className="gap-2 p-4">
        <Text className={cn('text-sm', entry.tone === 'error' && 'text-destructive')}>
          {entry.text}
        </Text>
        {entry.canRetry ? (
          <Button variant="outline" size="sm" label={c.retry} onPress={onRetry} />
        ) : null}
      </Card>
    );
  }

  const waiting = entry.state === 'streaming' && entry.text === '';
  return (
    <View
      className="max-w-[92%] gap-1 self-start rounded-3xl rounded-bl-lg bg-secondary px-4 py-3"
      accessibilityLabel={`${c.coach}: ${entry.text}`}
    >
      {entry.text !== '' ? <Text selectable>{entry.text}</Text> : null}
      {entry.state === 'streaming' && (waiting || entry.activity !== null) ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          {entry.activity ? (
            <Text variant="muted" className="text-xs">
              {c.tools[entry.activity]}
            </Text>
          ) : null}
        </View>
      ) : null}
      {entry.state === 'truncated' ? (
        <Text variant="muted" className="text-xs">
          {c.truncated}
        </Text>
      ) : null}
      {entry.state === 'interrupted' ? (
        <Text variant="muted" className="text-xs">
          {c.interrupted}
        </Text>
      ) : null}
      {entry.state === 'stopped' ? (
        <Text variant="muted" className="text-xs">
          {c.stopped}
        </Text>
      ) : null}
    </View>
  );
}

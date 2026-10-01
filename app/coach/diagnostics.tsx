import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { clearExchanges, listExchanges, type AiExchangeRow } from '@/db/repositories/aiExchanges';
import { formatDate, formatTime } from '@/lib/format';
import { pl } from '@/strings/pl';

/**
 * Every call to the Worker as it happened, in full, on this phone only.
 * The Worker's own log holds metadata and nothing else; when "why did it
 * say that?" needs an answer, this is where it is.
 */
export default function DiagnosticsScreen() {
  const [rows, setRows] = useState<AiExchangeRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    listExchanges()
      .then(setRows)
      .catch((error: unknown) => {
        console.warn('could not read the AI exchanges', error);
        setRows([]);
      });
  }, []);
  useFocusEffect(load);

  function confirmClear() {
    Alert.alert(pl.coach.diagnostics.clearTitle, pl.coach.diagnostics.clearBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.coach.diagnostics.clear,
        style: 'destructive',
        onPress: () => {
          void clearExchanges().then(load);
        },
      },
    ]);
  }

  const d = pl.coach.diagnostics;
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: d.title }} />
      <Text variant="muted">{d.intro}</Text>

      {rows !== null && rows.length === 0 ? <Text variant="muted">{d.empty}</Text> : null}

      {rows?.map((row) => (
        <Card key={row.id} className="gap-1 p-4">
          <Pressable onPress={() => setOpen(open === row.id ? null : row.id)}>
            <View className="flex-row items-baseline justify-between gap-3">
              <Text variant="heading">{row.outcome}</Text>
              <Text variant="muted" className="text-xs">
                {`${formatDate(row.createdAt.slice(0, 10))} ${formatTime(row.createdAt)}`}
              </Text>
            </View>
            <Text variant="muted" className="text-xs">
              {[row.model, row.promptVersion, d.line(row.tokensIn, row.tokensOut, row.latencyMs)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Text className="mt-1 font-display-semibold text-xs text-highlight">
              {open === row.id ? d.hide : d.show}
            </Text>
          </Pressable>
          {open === row.id ? (
            <View className="mt-2 gap-2">
              <Text variant="eyebrow">{d.request}</Text>
              <Text selectable className="font-mono text-xs leading-5">
                {JSON.stringify(row.request, null, 2)}
              </Text>
              <Text variant="eyebrow">{d.response}</Text>
              <Text selectable className="font-mono text-xs leading-5">
                {JSON.stringify(row.response, null, 2)}
              </Text>
            </View>
          ) : null}
        </Card>
      ))}

      {rows !== null && rows.length > 0 ? (
        <Button variant="outline" label={d.clear} onPress={confirmClear} />
      ) : null}
    </ScrollView>
  );
}

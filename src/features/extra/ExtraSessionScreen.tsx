import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';
import {
  ExtraSessionChangedError,
  loadExtraSession,
  previewExtraSession,
  startExtraSession,
} from './actions';
import { ExtraSessionPicker } from './ExtraSessionPicker';

export function ExtraSessionScreen() {
  const router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadExtraSession>> | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const guard = useRef(false);
  const load = useCallback(async (cancelled: () => boolean = () => false) => {
    try {
      const next = await loadExtraSession();
      if (!cancelled()) {
        setData(next);
        setSelected([]);
        setError(false);
      }
    } catch {
      if (!cancelled()) setError(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );
  const previewState = useMemo(() => {
    if (!data || selected.length === 0) return { preview: null, failed: null };
    try {
      const preview = previewExtraSession(selected);
      return preview.asOf === data.input.asOf
        ? { preview, failed: null }
        : { preview: null, failed: 'changed' as const };
    } catch {
      return { preview: null, failed: 'error' as const };
    }
  }, [data, selected]);
  const { preview } = previewState;
  const planned = preview?.output.result;
  const plan = planned?.kind === 'ready' || planned?.kind === 'adjusted' ? planned.plan : null;
  function open(id: string) {
    router.replace({ pathname: '/workout/active/[id]', params: { id } });
  }
  async function start() {
    if (guard.current || !preview) return;
    guard.current = true;
    setBusy(true);
    try {
      open(await startExtraSession(preview));
    } catch (e) {
      if (e instanceof ExtraSessionChangedError) {
        await load();
        Alert.alert(pl.extra.changed);
      } else Alert.alert(pl.extra.startError);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: pl.extra.title }} />
      {error || previewState.failed ? (
        <>
          <Text>{previewState.failed === 'changed' ? pl.extra.changed : pl.extra.loadError}</Text>
          <Button label={pl.plan.retry} onPress={() => void load()} />
        </>
      ) : !data ? (
        <ActivityIndicator />
      ) : (
        <>
          <Text variant="eyebrow">{formatDate(data.input.asOf, 'long')}</Text>
          {data.inProgress ? (
            <Button label={pl.workout.resume} onPress={() => open(data.inProgress!.id)} />
          ) : !data.done ? (
            <Text>{pl.extra.finishFirst}</Text>
          ) : data.rest ? (
            <Text>{pl.extra.rest}</Text>
          ) : (
            <>
              <ExtraSessionPicker
                data={data}
                preview={preview}
                selected={selected}
                onChange={setSelected}
                busy={busy}
              />
              <Button
                label={pl.extra.start}
                disabled={busy || !plan?.exposures.length}
                onPress={() => void start()}
              />
              {busy ? <ActivityIndicator /> : null}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

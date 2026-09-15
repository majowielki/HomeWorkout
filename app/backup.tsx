import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Download, Upload } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { BackupFile } from '@/db/backup/format';
import { UnknownExerciseError } from '@/db/repositories/backup';
import {
  exportBackup,
  importBackup,
  importSafetyBackup,
  listSafetyBackups,
  pickBackup,
  type SafetyBackup,
} from '@/lib/backup';
import { pl } from '@/strings/pl';

type Busy = 'idle' | 'exporting' | 'importing';
type Notice = { tone: 'ok' | 'error'; text: string } | null;

function errorText(e: unknown): string {
  if (e instanceof UnknownExerciseError) return pl.backup.errors.unknownExercises(e.ids);
  return e instanceof Error ? e.message : pl.common.error;
}

/**
 * Manual backup. One JSON file out through the share sheet, one file in
 * through the system picker — validated, confirmed with a row count, and
 * preceded by an automatic snapshot of what is about to be overwritten.
 * See Documents/IMPLEMENTACJA.md §7.5.
 */
export default function BackupScreen() {
  const [busy, setBusy] = useState<Busy>('idle');
  const [notice, setNotice] = useState<Notice>(null);
  const [safety, setSafety] = useState<SafetyBackup[]>(() => listSafetyBackups());

  const refreshSafety = useCallback(() => setSafety(listSafetyBackups()), []);

  async function handleExport() {
    if (busy !== 'idle') return;
    setBusy('exporting');
    setNotice(null);
    try {
      const file = await exportBackup();
      setNotice({ tone: 'ok', text: pl.backup.exported(file.name) });
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy('idle');
    }
  }

  async function runImport(data: BackupFile) {
    setBusy('importing');
    try {
      const { safetyBackupName } = await importBackup(data);
      setNotice({ tone: 'ok', text: pl.backup.imported(safetyBackupName) });
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) });
    } finally {
      refreshSafety();
      setBusy('idle');
    }
  }

  async function handleImport() {
    if (busy !== 'idle') return;
    setNotice(null);
    let picked: Awaited<ReturnType<typeof pickBackup>>;
    try {
      picked = await pickBackup();
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) });
      return;
    }
    if (picked.kind === 'canceled') return;
    if (!picked.parse.ok) {
      const detail = picked.parse.detail ? `\n${picked.parse.detail}` : '';
      setNotice({ tone: 'error', text: pl.backup.errors[picked.parse.reason] + detail });
      return;
    }

    const { tables } = picked.parse.data;
    const data = picked.parse.data;
    Alert.alert(
      pl.backup.confirmTitle,
      pl.backup.confirmBody(
        picked.name,
        tables.workouts.length,
        tables.set_logs.length,
        tables.body_metrics.filter((m) => m.source === 'manual').length,
      ),
      [
        { text: pl.common.cancel, style: 'cancel' },
        {
          text: pl.backup.confirmAction,
          style: 'destructive',
          onPress: () => void runImport(data),
        },
      ],
    );
  }

  function handleRestore(item: SafetyBackup) {
    if (busy !== 'idle') return;
    Alert.alert(pl.backup.restoreTitle, pl.backup.restoreBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.backup.restore,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('importing');
            setNotice(null);
            try {
              const result = await importSafetyBackup(item.uri);
              setNotice(
                result.ok
                  ? { tone: 'ok', text: pl.backup.imported(item.name) }
                  : { tone: 'error', text: pl.backup.errors[result.reason] },
              );
            } catch (e) {
              setNotice({ tone: 'error', text: errorText(e) });
            } finally {
              refreshSafety();
              setBusy('idle');
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4 pb-10">
      <Stack.Screen options={{ title: pl.backup.title }} />

      <Card>
        <CardTitle>{pl.backup.exportSection}</CardTitle>
        <CardDescription>{pl.backup.exportHint}</CardDescription>
        <CardContent className="mt-3">
          <Button onPress={handleExport} disabled={busy !== 'idle'}>
            <Upload size={18} className="text-primary-foreground" />
            <Text className="font-semibold text-primary-foreground">
              {busy === 'exporting' ? pl.backup.exporting : pl.backup.exportButton}
            </Text>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{pl.backup.importSection}</CardTitle>
        <CardDescription>{pl.backup.importHint}</CardDescription>
        <CardContent className="mt-3">
          <Button variant="outline" onPress={handleImport} disabled={busy !== 'idle'}>
            <Download size={18} className="text-foreground" />
            <Text className="font-semibold text-foreground">
              {busy === 'importing' ? pl.backup.importing : pl.backup.importButton}
            </Text>
          </Button>
        </CardContent>
      </Card>

      {notice ? (
        <Text className={notice.tone === 'error' ? 'text-sm text-destructive' : 'text-sm'}>
          {notice.text}
        </Text>
      ) : null}

      <Card>
        <CardTitle>{pl.backup.safetySection}</CardTitle>
        <CardDescription>{pl.backup.safetyHint}</CardDescription>
        <CardContent className="mt-2">
          {safety.length === 0 ? (
            <Text variant="muted">{pl.backup.safetyEmpty}</Text>
          ) : (
            safety.map((item) => (
              <View key={item.uri} className="flex-row items-center gap-3 py-1">
                <View className="flex-1">
                  <Text className="text-sm" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="muted" className="text-xs">
                    {pl.backup.sizeKb(item.sizeBytes)}
                  </Text>
                </View>
                <Button
                  label={pl.backup.restore}
                  variant="outline"
                  size="sm"
                  onPress={() => handleRestore(item)}
                  disabled={busy !== 'idle'}
                />
              </View>
            ))
          )}
        </CardContent>
      </Card>
    </ScrollView>
  );
}

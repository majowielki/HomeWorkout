import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { getProfile, getReminderSettings, updateProfile } from '@/db/repositories/profile';
import { isMuted, muteUntilDate, type ReminderSettings } from '@/domain/reminders/schedule';
import type { KneeProfile } from '@/domain/types';
import { syncReminders } from '@/lib/reminders';
import { useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const [loaded, setLoaded] = useState(false);
  const [heightCm, setHeightCm] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [dayBoundaryHour, setDayBoundaryHour] = useState(4);
  const [saddleHeightCm, setSaddleHeightCm] = useState('');
  const [knee, setKnee] = useState<KneeProfile | null>(null);
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(), getReminderSettings()]).then(([profile, rem]) => {
      if (cancelled) return;
      setHeightCm(formatDecimal(profile?.heightCm));
      setBirthYear(profile?.birthYear ? String(profile.birthYear) : '');
      setSex(profile?.sex ?? null);
      setDayBoundaryHour(profile?.dayBoundaryHour ?? 4);
      setSaddleHeightCm(formatDecimal(profile?.saddleHeightCm));
      setKnee(profile?.kneeProfile ?? null);
      setReminders(rem);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (saving || !reminders) return;
    const h = parseDecimal(heightCm);
    const y = parseDecimal(birthYear);
    const saddle = parseDecimal(saddleHeightCm);
    const invalid =
      (h !== null && (h < 100 || h > 250)) ||
      (y !== null && (y < 1900 || y > 2020 || !Number.isInteger(y))) ||
      (saddle !== null && (saddle < 30 || saddle > 150));
    if (invalid) {
      setError(pl.settings.invalidProfile);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateProfile({
        heightCm: h,
        birthYear: y,
        sex,
        dayBoundaryHour,
        saddleHeightCm: saddle,
        kneeProfile: knee,
        reminders,
      });
      // The only place that asks the OS for notification permission: the
      // user has just looked at the reminder switches, so the dialog has
      // context. Everywhere else a missing grant is silently tolerated.
      const wantsReminders = reminders.weight.enabled || reminders.workout.enabled;
      await syncReminders({ requestPermission: wantsReminders });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!loaded || !reminders) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const muted = isMuted(reminders, new Date());
  const switchColors = { false: colors.border, true: colors.primary };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 p-4 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: pl.settings.title }} />

      <Card>
        <CardTitle>{pl.settings.profileSection}</CardTitle>
        <CardContent className="gap-3">
          <View className="flex-row gap-3">
            <NumberField
              label={pl.settings.heightCm}
              value={heightCm}
              onChangeText={setHeightCm}
              kind="integer"
              className="flex-1"
            />
            <NumberField
              label={pl.settings.birthYear}
              value={birthYear}
              onChangeText={setBirthYear}
              kind="integer"
              className="flex-1"
            />
          </View>
          <View className="gap-1">
            <Text variant="muted">{pl.settings.sex}</Text>
            <View className="flex-row gap-2">
              <Chip
                label={pl.settings.sexMale}
                selected={sex === 'male'}
                onPress={() => setSex('male')}
              />
              <Chip
                label={pl.settings.sexFemale}
                selected={sex === 'female'}
                onPress={() => setSex('female')}
              />
            </View>
          </View>
          <Stepper
            label={pl.settings.dayBoundaryHour}
            value={`${dayBoundaryHour}:00`}
            onDecrement={() => setDayBoundaryHour((h) => Math.max(0, h - 1))}
            onIncrement={() => setDayBoundaryHour((h) => Math.min(23, h + 1))}
          />
          <Text variant="muted" className="text-xs">
            {pl.settings.dayBoundaryHint}
          </Text>
          <NumberField
            label={pl.settings.saddleHeightCm}
            value={saddleHeightCm}
            onChangeText={setSaddleHeightCm}
            hint={pl.settings.saddleHint}
          />
        </CardContent>
      </Card>

      {knee ? (
        <Card>
          <CardTitle>{pl.settings.kneeSection}</CardTitle>
          <CardContent>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1">{pl.settings.physioApproved}</Text>
              <Switch
                value={knee.physioApproved}
                onValueChange={(v) => setKnee({ ...knee, physioApproved: v })}
                trackColor={switchColors}
              />
            </View>
            <Text variant="muted" className="text-xs">
              {pl.settings.physioApprovedHint}
            </Text>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{pl.settings.remindersSection}</CardTitle>
        <CardContent className="gap-4">
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text>{pl.settings.weightReminder}</Text>
              <Switch
                value={reminders.weight.enabled}
                onValueChange={(v) =>
                  setReminders({ ...reminders, weight: { ...reminders.weight, enabled: v } })
                }
                trackColor={switchColors}
              />
            </View>
            <Stepper
              label={pl.settings.time}
              value={`${reminders.weight.hour}:00`}
              onDecrement={() =>
                setReminders({
                  ...reminders,
                  weight: { ...reminders.weight, hour: Math.max(0, reminders.weight.hour - 1) },
                })
              }
              onIncrement={() =>
                setReminders({
                  ...reminders,
                  weight: { ...reminders.weight, hour: Math.min(23, reminders.weight.hour + 1) },
                })
              }
            />
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text>{pl.settings.workoutReminder}</Text>
              <Switch
                value={reminders.workout.enabled}
                onValueChange={(v) =>
                  setReminders({ ...reminders, workout: { ...reminders.workout, enabled: v } })
                }
                trackColor={switchColors}
              />
            </View>
            <View className="flex-row gap-3">
              <Stepper
                label={pl.settings.afterDays(reminders.workout.afterDays)}
                value={String(reminders.workout.afterDays)}
                onDecrement={() =>
                  setReminders({
                    ...reminders,
                    workout: {
                      ...reminders.workout,
                      afterDays: Math.max(1, reminders.workout.afterDays - 1),
                    },
                  })
                }
                onIncrement={() =>
                  setReminders({
                    ...reminders,
                    workout: {
                      ...reminders.workout,
                      afterDays: Math.min(14, reminders.workout.afterDays + 1),
                    },
                  })
                }
                className="flex-1"
              />
              <Stepper
                label={pl.settings.time}
                value={`${reminders.workout.hour}:00`}
                onDecrement={() =>
                  setReminders({
                    ...reminders,
                    workout: {
                      ...reminders.workout,
                      hour: Math.max(0, reminders.workout.hour - 1),
                    },
                  })
                }
                onIncrement={() =>
                  setReminders({
                    ...reminders,
                    workout: {
                      ...reminders.workout,
                      hour: Math.min(23, reminders.workout.hour + 1),
                    },
                  })
                }
                className="flex-1"
              />
            </View>
          </View>

          {muted ? (
            <View className="gap-2">
              <Text variant="muted">{pl.settings.mutedUntil(reminders.mutedUntil ?? '')}</Text>
              <Button
                label={pl.settings.unmute}
                variant="outline"
                onPress={() => setReminders({ ...reminders, mutedUntil: null })}
              />
            </View>
          ) : (
            <Button
              label={pl.settings.muteWeek}
              variant="outline"
              onPress={() => setReminders({ ...reminders, mutedUntil: muteUntilDate(new Date()) })}
            />
          )}
        </CardContent>
      </Card>

      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
      <Button label={pl.settings.save} size="lg" onPress={handleSave} disabled={saving} />
    </ScrollView>
  );
}

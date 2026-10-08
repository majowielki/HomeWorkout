import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { PlannerInput } from '@/domain/plan/dayPlanner';
import { extraSessionOptions, planCustom } from '@/domain/plan/extra';
import { prescriptionText } from '@/features/plan/format';
import { pl } from '@/strings/pl';

type Props = {
  input: PlannerInput;
  selected: string[];
  onChange: (ids: string[]) => void;
  busy: boolean;
};

export function ExtraSessionPicker({ input, selected, onChange, busy }: Props) {
  const options = extraSessionOptions(input);
  const available = options.filter((o) => o.item);
  const blocked = options.filter((o) => !o.item);
  const preview = planCustom(input, selected);
  return (
    <View className="gap-4">
      <Text variant="muted">{pl.extra.intro}</Text>
      <Text variant="eyebrow">{pl.extra.available}</Text>
      {!available.length ? <Text>{pl.extra.empty}</Text> : null}
      {available.map((o) => {
        const checked = selected.includes(o.slotId);
        const slot = input.slots.find((s) => s.id === o.slotId)!;
        const e = input.catalog[o.item!.exerciseId]!;
        return (
          <Pressable
            key={o.slotId}
            accessibilityRole="checkbox"
            accessibilityLabel={slot.name}
            accessibilityState={{ checked, disabled: busy }}
            disabled={busy}
            onPress={() =>
              onChange(checked ? selected.filter((id) => id !== o.slotId) : [...selected, o.slotId])
            }
            className={`gap-1 rounded-2xl border p-4 ${checked ? 'border-primary bg-secondary' : 'border-border bg-card'}`}
          >
            <Text className="font-display-semibold">
              {checked ? '✓ ' : ''}
              {slot.name}
            </Text>
            <Text>{e.name}</Text>
            <Text variant="muted">
              {e.primaryMuscles.map((m) => pl.labels.muscle[m]).join(', ')} ·{' '}
              {pl.calendar.sets(o.item!.sets, e.sides === 'perSet')}
            </Text>
          </Pressable>
        );
      })}
      {selected.length ? (
        <Card className="gap-3">
          <Text variant="eyebrow">{pl.extra.preview}</Text>
          <Text>{pl.plan.meta(preview.estimatedMinutes)}</Text>
          {preview.exercises.map((e) => (
            <View key={e.exerciseId} className="gap-1">
              <Text className="font-display-semibold">
                {e.label} · {input.catalog[e.exerciseId]!.name}
              </Text>
              <Text variant="muted">{prescriptionText(e)}</Text>
            </View>
          ))}
          {preview.exercises.length < selected.length ? <Text>{pl.extra.reduced}</Text> : null}
          {preview.skipped.map((s) => (
            <Text key={s.slotId} variant="muted">
              {input.slots.find((slot) => slot.id === s.slotId)!.name} · {pl.plan.skip[s.reason]}
            </Text>
          ))}
          <Text variant="muted">{pl.extra.weekHint}</Text>
        </Card>
      ) : (
        <Text variant="muted">{pl.extra.choose}</Text>
      )}
      {blocked.length ? <Text variant="eyebrow">{pl.extra.unavailable}</Text> : null}
      {blocked.map((o) => (
        <Text key={o.slotId} variant="muted">
          {input.slots.find((s) => s.id === o.slotId)!.name} · {pl.plan.skip[o.reason!]}
        </Text>
      ))}
    </View>
  );
}

import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { planTitle } from '@/features/plan/format';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';
import type { ProposalStatus, ProposalView } from './proposals';

type Props = {
  proposal: ProposalView;
  status: ProposalStatus;
  busy: boolean;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
};

export function ProposalCard({ proposal, status, busy, onApply, onReject }: Props) {
  const t = pl.coach.chat.proposal;
  const summary = proposal.summary;
  const dayTitle = (day: { rest: boolean; regions: Parameters<typeof planTitle>[0]['regions'] }) =>
    day.rest ? pl.plan.banner.rest : planTitle(day);
  return (
    <Card className="gap-3 border-primary">
      <Text variant="eyebrow">{summary.kind === 'plan' ? t.plan : pl.extra.title}</Text>
      {proposal.note ? <Text>{proposal.note}</Text> : null}
      {summary.kind === 'plan' ? (
        <>
          {summary.constraints.map((c, i) => (
            <View key={i} className="gap-1">
              <Text className="font-display-semibold">
                {t.constraint[c.kind]}
                {c.muscles.length
                  ? ` · ${c.muscles.map((m) => pl.labels.muscle[m]).join(', ')}`
                  : ''}
              </Text>
              <Text variant="muted">
                {formatDate(c.from)} — {formatDate(c.until)}
              </Text>
            </View>
          ))}
          {summary.changes.length ? (
            summary.changes.map(({ before, after }) => (
              <View key={after.date} className="gap-1 rounded-2xl bg-secondary p-3">
                <Text className="font-display-semibold">
                  {formatDate(after.date)} · {dayTitle(before)} → {dayTitle(after)}
                </Text>
                <Text variant="muted">
                  {t.before}:{' '}
                  {before.exercises
                    .map((e) => `${e.exercise.name} (${pl.calendar.sets(e.sets, e.perSide)})`)
                    .join(', ') || pl.plan.banner.rest}
                </Text>
                <Text>
                  {t.after}:{' '}
                  {after.exercises
                    .map((e) => `${e.exercise.name} (${pl.calendar.sets(e.sets, e.perSide)})`)
                    .join(', ') || pl.plan.banner.rest}
                </Text>
              </View>
            ))
          ) : (
            <Text variant="muted">{t.noChanges}</Text>
          )}
        </>
      ) : (
        <>
          <Text>
            {formatDate(summary.day.date)} · {pl.plan.meta(summary.day.estimatedMinutes)}
          </Text>
          <Text variant="muted">
            {summary.focusMuscles.map((m) => pl.labels.muscle[m]).join(', ')}
          </Text>
          {summary.day.exercises.map((e) => (
            <Text key={e.exercise.id}>
              {e.exercise.name} · {pl.calendar.sets(e.sets, e.perSide)}
            </Text>
          ))}
          {summary.day.skipped.map((s) => (
            <Text key={s.movement} variant="muted">
              {s.movement} · {pl.plan.skip[s.reason]}
            </Text>
          ))}
          <Text variant="muted">{t.extraHint}</Text>
        </>
      )}
      <Text variant="muted">{t.status[status]}</Text>
      {status === 'applying' ? <ActivityIndicator /> : null}
      {status === 'pending' || status === 'failed' ? (
        <View className="gap-2">
          <Button label={t.apply} disabled={busy} onPress={() => onApply(proposal.id)} />
          <Button
            variant="outline"
            label={t.reject}
            disabled={busy}
            onPress={() => onReject(proposal.id)}
          />
        </View>
      ) : null}
    </Card>
  );
}

import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { dayTitle as formatDayTitle } from '@/features/plan/format';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';
import type { ProposalStatus, ProposalSummary, ProposalView } from '@/app-services/coach/proposals';

type Changes = Extract<ProposalSummary, { kind: 'plan' | 'compose' }>['changes'];
type Day = Changes[number]['after'];

const dayTitle = (day: Day) => (day.rest ? pl.plan.banner.rest : formatDayTitle(day.regions));
const exercisesOf = (day: Day) =>
  day.exercises
    .map((e) => `${e.exercise.name} (${pl.calendar.sets(e.sets, e.perSide)})`)
    .join(', ') || pl.plan.banner.rest;

/** Each day that differs: what the engine planned before, and what it will plan. */
function ChangesList({ changes }: { changes: Changes }) {
  const t = pl.coach.chat.proposal;
  if (!changes.length) return <Text variant="muted">{t.noChanges}</Text>;
  return (
    <>
      {changes.map(({ before, after }) => (
        <View key={after.date} className="gap-1 rounded-2xl bg-secondary p-3">
          <Text className="font-display-semibold">
            {formatDate(after.date)} · {dayTitle(before)} → {dayTitle(after)}
          </Text>
          <Text variant="muted">
            {t.before}: {exercisesOf(before)}
          </Text>
          <Text>
            {t.after}: {exercisesOf(after)}
          </Text>
        </View>
      ))}
    </>
  );
}

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
  const title = {
    plan: t.plan,
    extra: pl.extra.title,
    compose: t.compose,
    session_change: t.sessionChange,
  }[summary.kind];
  return (
    <Card className="gap-3 border-primary">
      <Text variant="eyebrow">{title}</Text>
      {proposal.note ? <Text>{proposal.note}</Text> : null}
      {summary.kind === 'session_change' ? (
        <>
          {summary.sentences.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </>
      ) : summary.kind === 'plan' ? (
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
          <ChangesList changes={summary.changes} />
        </>
      ) : summary.kind === 'compose' ? (
        <>
          <Text variant="muted">{t.composeHint}</Text>
          <ChangesList changes={summary.changes} />
          {summary.days
            .filter((d) => d.conflicts.length > 0)
            .map((d) => (
              <View key={d.date} className="gap-1">
                <Text className="font-display-semibold">
                  {formatDate(d.date)} · {t.conflictsTitle}
                </Text>
                {d.conflicts.map((c) => (
                  <Text key={c.movement} variant="muted">
                    {c.movement} ·{' '}
                    {c.reason === 'REST_DAY' ? pl.plan.banner.rest : pl.plan.skip[c.reason]}
                  </Text>
                ))}
              </View>
            ))}
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

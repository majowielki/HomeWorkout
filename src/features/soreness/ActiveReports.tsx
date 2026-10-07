import { Link } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { PlanConstraint } from '@/domain/plan/constraints';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

export function ActiveReports({
  constraints,
  asOf,
  busy,
  onRevoke,
}: {
  constraints: PlanConstraint[];
  asOf: string;
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const t = pl.soreness;
  const reports = constraints.filter(
    (c) => c.kind === 'avoid_muscle' && (c.reason === 'doms' || c.reason === 'pain'),
  );
  return (
    <View className="gap-3">
      <Text variant="title">{t.activeTitle}</Text>
      {reports.length === 0 ? (
        <Text variant="muted">{t.none}</Text>
      ) : (
        reports.map((c) => {
          const names = c.muscles.map((m) => pl.labels.muscle[m]).join(', ');
          return (
            <Card key={c.id} className="gap-2">
              <CardTitle>{names}</CardTitle>
              <Text>{c.reason === 'pain' ? t.reason.pain : t.reason.doms}</Text>
              <Text variant="muted" className="text-sm">
                {t.range(formatDate(c.from), formatDate(c.until))}
              </Text>
              <Text className="text-sm">{c.reason === 'pain' ? t.painEffect : t.domsEffect}</Text>
              {c.source === 'coach' ? (
                <Text variant="muted" className="text-xs">
                  {t.coach}
                </Text>
              ) : null}
              <Button
                label={t.revoke}
                variant="outline"
                disabled={busy}
                accessibilityLabel={t.revokeLabel(`${names}, ${formatDate(c.until)}`)}
                onPress={() => onRevoke(c.id)}
              />
            </Card>
          );
        })
      )}
      <Text variant="muted" className="text-xs leading-5">
        {t.diaryHint}
      </Text>
      <Link href={{ pathname: '/body/daily', params: { date: asOf } }} asChild>
        <Button variant="ghost" label={t.diary} disabled={busy} />
      </Link>
    </View>
  );
}

import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import {
  assessReport,
  emptyReport,
  REPORT_KINDS,
  type PainAnswers,
  type ReportKind,
  type SorenessReport,
} from '@/domain/plan/sorenessReport';
import type { MuscleGroup } from '@/domain/types';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

type Props = { asOf: string; busy: boolean; onSubmit: (report: SorenessReport) => void };

/** Three small steps: symptoms, affected muscles, then the exact planner request. */
export function SorenessForm({ asOf, busy, onSubmit }: Props) {
  const t = pl.soreness;
  const [report, setReport] = useState(emptyReport);
  const [step, setStep] = useState(0);
  const decision = assessReport(report, asOf);
  function chooseKind(kind: ReportKind) {
    setReport((r) => ({
      ...r,
      kind,
      days: kind === 'muscle_pain' ? 3 : 2,
      pain: emptyReport().pain,
    }));
  }
  function toggleMuscle(muscle: MuscleGroup) {
    setReport((r) => ({
      ...r,
      muscles: r.muscles.includes(muscle)
        ? r.muscles.filter((m) => m !== muscle)
        : [...r.muscles, muscle],
    }));
  }
  const names = report.muscles.map((m) => pl.labels.muscle[m]).join(', ');
  const firstReady =
    report.kind !== null && report.redFlags === false && decision.kind !== 'medical';
  const ready = decision.kind === 'restriction' || decision.kind === 'mild';

  return (
    <View className="gap-4" pointerEvents={busy ? 'none' : 'auto'}>
      <Text variant="muted">{t.intro}</Text>
      {step === 0 ? (
        <>
          <Card className="gap-3">
            <CardTitle>{t.kindTitle}</CardTitle>
            {REPORT_KINDS.map((kind) => (
              <Chip
                key={kind}
                label={t.kind[kind]}
                selected={report.kind === kind}
                onPress={() => chooseKind(kind)}
              />
            ))}
          </Card>
          {report.kind !== null ? (
            <Card className="gap-3">
              <CardTitle>{t.redTitle}</CardTitle>
              {t.redList.map((line) => (
                <Text key={line} className="text-sm">
                  • {line}
                </Text>
              ))}
              <Chip
                label={t.redNone}
                selected={report.redFlags === false}
                onPress={() => setReport((r) => ({ ...r, redFlags: false }))}
              />
              <Chip
                label={t.redSome}
                selected={report.redFlags === true}
                onPress={() => setReport((r) => ({ ...r, redFlags: true }))}
              />
            </Card>
          ) : null}
          {decision.kind === 'medical' ? (
            <Card className="gap-3 border-destructive">
              <CardTitle>
                {decision.reason === 'redFlags' ? t.redHeading : t.jointHeading}
              </CardTitle>
              <Text className="leading-6">
                {decision.reason === 'redFlags' ? t.redBody : t.jointBody}
              </Text>
              {decision.reason === 'joint' ? (
                <>
                  <Text variant="muted" className="text-sm">
                    {t.settingsHint}
                  </Text>
                  <Link href="/settings" asChild>
                    <Button variant="outline" label={t.settings} />
                  </Link>
                </>
              ) : null}
            </Card>
          ) : (
            <Button label={t.next} disabled={!firstReady || busy} onPress={() => setStep(1)} />
          )}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Card className="gap-3">
            <CardTitle>{t.musclesTitle}</CardTitle>
            <View className="flex-row flex-wrap gap-2">
              {MUSCLE_GROUPS.map((m) => (
                <Chip
                  key={m}
                  label={pl.labels.muscle[m]}
                  selected={report.muscles.includes(m)}
                  onPress={() => toggleMuscle(m)}
                />
              ))}
            </View>
          </Card>
          {report.kind === 'muscle_pain' ? (
            <Card className="gap-4">
              <CardTitle>{t.painTitle}</CardTitle>
              <Text variant="muted" className="text-sm">
                {t.painHint}
              </Text>
              <PainQuestion
                field="onset"
                answer={report.pain.onset}
                onChoose={(onset) => setReport((r) => ({ ...r, pain: { ...r.pain, onset } }))}
              />
              <PainQuestion
                field="location"
                answer={report.pain.location}
                onChoose={(location) => setReport((r) => ({ ...r, pain: { ...r.pain, location } }))}
              />
              <PainQuestion
                field="movement"
                answer={report.pain.movement}
                onChoose={(movement) => setReport((r) => ({ ...r, pain: { ...r.pain, movement } }))}
              />
            </Card>
          ) : null}
          {!ready && decision.kind === 'incomplete' ? (
            <Text variant="muted" className="text-sm">
              {t.required[decision.field]}
            </Text>
          ) : null}
          <Button label={t.next} disabled={!ready || busy} onPress={() => setStep(2)} />
          <Button label={t.previous} variant="ghost" onPress={() => setStep(0)} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card className="gap-3">
            <CardTitle>{t.review}</CardTitle>
            <Text className="font-display-semibold">{names}</Text>
            {decision.kind === 'restriction' ? (
              <>
                <Text>{report.kind === 'muscle_pain' ? t.painEffect : t.domsEffect}</Text>
                <Text variant="eyebrow">{t.duration}</Text>
                <View className="flex-row gap-2">
                  {[1, 2, 3].map((days) => (
                    <Chip
                      key={days}
                      label={t.days(days)}
                      selected={report.days === days}
                      onPress={() => setReport((r) => ({ ...r, days }))}
                    />
                  ))}
                </View>
                <Text>
                  {t.range(
                    formatDate(decision.constraint.from),
                    formatDate(decision.constraint.until),
                  )}
                </Text>
                {report.kind === 'muscle_pain' ? (
                  <>
                    <Text className="text-sm leading-5">
                      {decision.strainSignals ? t.strainHint : t.painUncertain}
                    </Text>
                    <Text variant="muted" className="text-sm leading-5">
                      {t.expiryHint}
                    </Text>
                  </>
                ) : null}
              </>
            ) : (
              <Text>{t.mildEffect}</Text>
            )}
          </Card>
          <Button
            label={busy ? t.saving : decision.kind === 'mild' ? t.saveMild : t.save}
            disabled={!ready || busy}
            onPress={() => onSubmit(report)}
          />
          <Button label={t.previous} variant="ghost" disabled={busy} onPress={() => setStep(1)} />
        </>
      ) : null}
    </View>
  );
}

function PainQuestion<K extends keyof PainAnswers>({
  field,
  answer,
  onChoose,
}: {
  field: K;
  answer: PainAnswers[K];
  onChoose: (answer: NonNullable<PainAnswers[K]>) => void;
}) {
  const labels: Record<string, string> = pl.soreness.answers[field];
  return (
    <View className="gap-2">
      <Text className="font-display-semibold">{pl.soreness.questions[field]}</Text>
      <View className="flex-row flex-wrap gap-2">
        {(Object.keys(labels) as NonNullable<PainAnswers[K]>[]).map((value) => (
          <Chip
            key={value}
            label={labels[value]!}
            selected={answer === value}
            onPress={() => onChoose(value)}
          />
        ))}
      </View>
    </View>
  );
}

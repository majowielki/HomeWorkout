import { recordMildSoreness } from '@/db/repositories/dailyLogs';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { addConstraint, revokeConstraints } from '@/db/repositories/weekPlan';
import { assessReport, type SorenessReport } from '@/domain/plan/sorenessReport';
import { trainingDate } from '@/domain/time/trainingDate';
import { computeToday } from '@/features/plan/computeToday';

export class ReportDateChangedError extends Error {}

/** Validate again at the write boundary. Medical or incomplete drafts write nothing. */
export async function saveSorenessReport(
  report: SorenessReport,
  expectedDate: string,
  now = new Date(),
) {
  const asOf = trainingDate(now, await getDayBoundaryHour());
  if (asOf !== expectedDate) throw new ReportDateChangedError();
  const decision = assessReport(report, asOf);
  if (decision.kind !== 'mild' && decision.kind !== 'restriction')
    throw new Error('Report is not ready');
  if (decision.kind === 'mild') await recordMildSoreness(asOf, decision.muscles, now);
  else await addConstraint(decision.constraint, now);
  // A saved report remains available if replanning fails; the next focus retries.
  // Separate this result so retrying the plan cannot duplicate the report.
  let planUpdated = true;
  try {
    await computeToday({ persist: true, request: { trigger: 'constraint', from: asOf } });
  } catch {
    planUpdated = false;
  }
  return { decision, planUpdated };
}

export async function withdrawSorenessReport(id: string, asOf: string) {
  await revokeConstraints([id]);
  let planUpdated = true;
  try {
    await computeToday({ persist: true, request: { trigger: 'constraint', from: asOf } });
  } catch {
    planUpdated = false;
  }
  return { planUpdated };
}

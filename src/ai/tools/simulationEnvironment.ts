/**
 * The phone's side of `simulateProposal` (contract 7, 11 §13): the model's relative dates and kinds of
 * request become the drafts the planner takes, the planner runs twice, and what comes back is cut down
 * to figures. `base()` is a fresh reading of everything the week is planned from; a change to the
 * running workout also needs that workout, and without one the answer is `no_active_session`.
 */
import { addDays } from '../../domain/time/trainingDate';
import type { PlanConstraint } from '../../domain/plan/constraints';
import type { TrainingPreferences } from '../../domain/preferences/preferences';
import {
  simulateProposal,
  type SimulateProposalInput,
  type SimulationBase,
  type SimulationSummary,
} from '../../domain/session/simulateProposal';
import type { ToolError, ToolInput, ToolOutput } from '../contract/chatTools';
import { SIMULATION_LIMITS } from '../contract/simulationTools';
import { changeOf } from './sessionEnvironment';
import { trimmedChecks } from './sessionSummary';

type Input = ToolInput<'simulateProposal'>;

function toDomain(base: SimulationBase, input: Input['proposal']): SimulateProposalInput {
  if (input.kind === 'week_change') {
    return {
      kind: 'week_change',
      constraints: input.constraints.map((c): Omit<PlanConstraint, 'id'> => {
        const from = addDays(base.asOf, c.fromDaysAhead);
        return {
          kind: c.kind,
          muscles: c.muscles,
          from,
          until: addDays(from, c.days - 1),
          reason: c.reason,
          source: 'coach',
          note: null,
        };
      }),
    };
  }
  if (input.kind === 'policy_change') {
    const byKind = Object.fromEntries(
      Object.entries(input.setsPerExposure ?? {}).filter(([, n]) => n !== undefined),
    ) as Partial<Record<'compound' | 'accessory' | 'core', number>>;
    const preferences: Partial<TrainingPreferences> = {
      ...(Object.keys(byKind).length === 0
        ? {}
        : { setsPerExposure: { mode: 'fixed' as const, byKind } }),
      ...(input.volumeProfile === undefined ? {} : { volumeProfile: input.volumeProfile }),
    };
    return { kind: 'policy_change', preferences };
  }
  return { kind: 'session_change', change: changeOf(input.change) };
}

const summaryOf = (s: SimulationSummary) => ({
  musclesWeek: Object.entries(s.musclesWeek).map(([muscle, w]) => ({
    muscle: muscle as ToolOutput<'simulateProposal'>['baseline']['musclesWeek'][number]['muscle'],
    sets: Math.round(w.sets),
    min: w.min,
    max: w.max,
  })),
  minutesPerDay: s.minutesPerDay,
  expectedLoadSteps: s.expectedLoadSteps,
  expectedProbes: s.expectedProbes,
  deloadTriggered: s.deloadTriggered,
});

export function createSimulationHook(base: () => SimulationBase) {
  return async function simulate(
    input: Input,
  ): Promise<ToolOutput<'simulateProposal'> | ToolError> {
    const b = base();
    if (input.proposal.kind === 'session_change' && b.session === undefined) {
      return { error: 'no_active_session' };
    }
    const result = simulateProposal(b, toDomain(b, input.proposal), {
      horizonDays: input.horizonDays,
      athlete: input.athlete,
    });
    return {
      horizonDays: input.horizonDays,
      athlete: input.athlete,
      baseline: summaryOf(result.baseline),
      withProposal: summaryOf(result.withProposal),
      diff: {
        musclesWeek: Object.entries(result.diff.musclesWeek).map(([muscle, sets]) => ({
          muscle: muscle as ToolOutput<'simulateProposal'>['diff']['musclesWeek'][number]['muscle'],
          sets: Math.round(sets),
        })),
        minutesPerDay: result.diff.minutesPerDay,
        expectedLoadSteps: result.diff.expectedLoadSteps,
        expectedProbes: result.diff.expectedProbes,
        deloadTriggered: result.diff.deloadTriggered,
        daysChanged: result.diff.daysChanged.slice(0, SIMULATION_LIMITS.daysShown),
      },
      warnings: trimmedChecks(result.warnings).slice(0, SIMULATION_LIMITS.warningsShown),
      verdict: result.assessment?.verdict ?? null,
    };
  };
}

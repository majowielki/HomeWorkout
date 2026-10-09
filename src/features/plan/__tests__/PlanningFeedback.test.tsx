import { render, screen } from '@testing-library/react-native';
import { finding } from '@/domain/policy/hardAdvice';
import { checkText } from '@/domain/session/assessmentText';
import { PlanningFeedback } from '../PlanningFeedback';
import { pl } from '@/strings/pl';

it('shows the actual audit reason for an unavailable plan', async () => {
  const issue = {
    ...finding('REST_DAY', 'fail'),
    scope: { level: 'session' as const },
    repairs: [],
  };
  await render(
    <PlanningFeedback
      result={{ kind: 'no_feasible_plan', changes: [], reasons: [issue, issue] }}
    />,
  );
  expect(screen.getAllByText(checkText(issue))).toHaveLength(1);
});
it('explains a repaired plan without exposing internal codes', async () => {
  await render(
    <PlanningFeedback result={{ kind: 'adjusted', plan: {} as never, changes: [], notes: [] }} />,
  );
  expect(screen.getByText(pl.plan.adjustedPlan)).toBeTruthy();
});

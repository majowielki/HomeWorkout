import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProposalCard } from '../ProposalCard';
import { previewDayPlan, previewPlanChange, summarizeDay } from '@/ai/tools/planPreview';
import { dayInput } from '@/domain/__tests__/dayFixtures';
import { planDay } from '@/domain/plan/day';
import { summaryOf } from '@/domain/plan/week';
import { pl } from '@/strings/pl';
import { proposalSnapshot, restIntent } from './proposalFixtures';

it('shows the engine diff and writes only through the apply action', async () => {
  const s = proposalSnapshot();
  const proposal = {
    id: 'p',
    summary: previewPlanChange(s, restIntent, 'p').summary,
    note: restIntent.note,
  };
  const onApply = jest.fn(),
    onReject = jest.fn();
  const view = await render(
    <ProposalCard
      proposal={proposal}
      status="pending"
      busy={false}
      onApply={onApply}
      onReject={onReject}
    />,
  );
  expect(screen.getByText(pl.coach.chat.proposal.status.pending)).toBeTruthy();
  expect(screen.getAllByText(/→/).length).toBeGreaterThan(0);
  expect(onApply).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Odrzuć'));
  expect(onReject).toHaveBeenCalledWith('p');
  expect(onApply).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Zastosuj'));
  expect(onApply).toHaveBeenCalledWith('p');
  await view.rerender(
    <ProposalCard
      proposal={proposal}
      status="applying"
      busy
      onApply={onApply}
      onReject={onReject}
    />,
  );
  expect(screen.queryByText('Zastosuj')).toBeNull();
  await view.rerender(
    <ProposalCard
      proposal={proposal}
      status="stale"
      busy={false}
      onApply={onApply}
      onReject={onReject}
    />,
  );
  expect(screen.getByText(pl.coach.chat.proposal.status.stale)).toBeTruthy();
  expect(screen.queryByText('Zastosuj')).toBeNull();
});
it('previews an additional session with set counts and tells what applying does', async () => {
  const s = proposalSnapshot(true);
  const output = planDay({
    ...dayInput(),
    only: [{ slotId: 'push-horizontal' }],
    session: { ...dayInput().session, kind: 'extra' },
  });
  if (!('plan' in output.result)) throw new Error('Expected an extra plan');
  const plan = output.result.plan;
  const proposal = {
    id: 'p',
    note: '',
    summary: {
      kind: 'extra' as const,
      requiresAcceptance: true as const,
      proposalId: 'p',
      focusMuscles: ['chest' as const],
      day: summarizeDay(s, plan.trainingDate, {
        forecast: plan,
        summary: summaryOf(output, plan, false, 1),
      }),
    },
  };
  await render(
    <ProposalCard
      proposal={proposal}
      status="pending"
      busy={false}
      onApply={jest.fn()}
      onReject={jest.fn()}
    />,
  );
  expect(screen.getByText(pl.extra.title)).toBeTruthy();
  expect(screen.getByText(new RegExp(plan.exposures[0]!.exercise.displayName))).toBeTruthy();
  expect(screen.getByText(pl.coach.chat.proposal.extraHint)).toBeTruthy();
  expect(screen.queryByText(/kg|RIR/)).toBeNull();
});

it('shows a composed day with what the engine did not take', async () => {
  const s = proposalSnapshot();
  s.constraints = [
    {
      id: 'rest',
      kind: 'rest_day',
      from: '2026-10-06',
      until: '2026-10-06',
      muscles: [],
      reason: 'busy',
      source: 'user',
      note: null,
    },
  ];
  const intent = {
    days: [
      { daysAhead: 1, slots: [{ slotId: 'pull-horizontal' }] },
      {
        daysAhead: 2,
        slots: [{ slotId: 'pull-horizontal', sets: 1 }, { slotId: 'push-horizontal' }],
      },
    ],
    note: 'Górna partia.',
  };
  const summary = previewDayPlan(s, intent, 'c').summary;
  await render(
    <ProposalCard
      proposal={{ id: 'c', summary, note: intent.note }}
      status="pending"
      busy={false}
      onApply={jest.fn()}
      onReject={jest.fn()}
    />,
  );
  expect(screen.getByText(pl.coach.chat.proposal.compose)).toBeTruthy();
  expect(screen.getByText(pl.coach.chat.proposal.composeHint)).toBeTruthy();
  expect(screen.getByText(new RegExp(pl.coach.chat.proposal.conflictsTitle))).toBeTruthy();
  expect(screen.getByText(/Przyciąganie poziome · wolne/)).toBeTruthy();
});
it('shows the engine assessment for a session change before its acceptance', async () => {
  const onApply = jest.fn();
  await render(
    <ProposalCard
      proposal={{
        id: 'session-card',
        note: '',
        summary: {
          kind: 'session_change',
          sentences: ['Pozostałe serie zostaną pominięte.', 'Plan został oceniony przez silnik.'],
        },
      }}
      status="pending"
      busy={false}
      onApply={onApply}
      onReject={jest.fn()}
    />,
  );
  expect(screen.getByText(pl.coach.chat.proposal.sessionChange)).toBeTruthy();
  expect(screen.getByText('Pozostałe serie zostaną pominięte.')).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText(pl.coach.chat.proposal.apply));
  expect(onApply).toHaveBeenCalledWith('session-card');
});

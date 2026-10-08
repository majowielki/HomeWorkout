import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProposalCard } from '../ProposalCard';
import { previewDayPlan, previewPlanChange, summarizePlan } from '@/features/plan/coachPreview';
import { planCustom } from '@/domain/plan/extra';
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
  const plan = planCustom({ ...s.input, block: s.advance.block }, ['push']);
  const proposal = {
    id: 'p',
    note: '',
    summary: {
      kind: 'extra' as const,
      requiresAcceptance: true as const,
      proposalId: 'p',
      focusMuscles: ['chest' as const],
      day: summarizePlan(s, plan.date, plan),
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
  expect(screen.getByText('Pchanie · 2 serie')).toBeTruthy();
  expect(screen.getByText(pl.coach.chat.proposal.extraHint)).toBeTruthy();
  expect(screen.queryByText(/kg|RIR/)).toBeNull();
});

it('shows a composed day with what the engine did not take', async () => {
  const s = proposalSnapshot();
  const intent = {
    days: [
      { daysAhead: 1, slots: [{ slotId: 'pull' }] },
      { daysAhead: 2, slots: [{ slotId: 'pull', sets: 1 }, { slotId: 'push' }] },
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
  expect(screen.getByText(`Plecy · ${pl.plan.skip.RECOVERING}`)).toBeTruthy();
});

import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PlanConstraint } from '@/domain/plan/constraints';
import { pl } from '@/strings/pl';
import { ActiveReports } from '../ActiveReports';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
const constraints: PlanConstraint[] = [
  {
    id: 'sore',
    kind: 'avoid_muscle',
    muscles: ['chest'],
    from: '2026-10-07',
    until: '2026-10-08',
    reason: 'doms',
    source: 'user',
    note: null,
  },
  {
    id: 'pain',
    kind: 'avoid_muscle',
    muscles: ['back'],
    from: '2026-10-07',
    until: '2026-10-09',
    reason: 'pain',
    source: 'coach',
    note: null,
  },
  {
    id: 'rest',
    kind: 'rest_day',
    muscles: [],
    from: '2026-10-07',
    until: '2026-10-07',
    reason: 'busy',
    source: 'user',
    note: null,
  },
];
it('lists symptom reports with dates and effects, keeps rest-day overrides out, and revokes only the tapped report', async () => {
  const revoke = jest.fn();
  await render(
    <ActiveReports asOf="2026-10-07" constraints={constraints} busy={false} onRevoke={revoke} />,
  );
  expect(screen.getAllByText(pl.soreness.revoke)).toHaveLength(2);
  expect(screen.getByText(pl.soreness.coach)).toBeTruthy();
  expect(screen.getByText(pl.soreness.diaryHint)).toBeTruthy();
  const button = screen.getByLabelText(/Odwołaj zgłoszenie:.*klatka/);
  await fireEvent.press(button);
  expect(revoke).toHaveBeenCalledWith('sore');
  expect(revoke).toHaveBeenCalledTimes(1);
});
it('shows empty state and disables revocation during a write', async () => {
  const revoke = jest.fn();
  const view = await render(
    <ActiveReports asOf="2026-10-07" constraints={[]} busy={false} onRevoke={revoke} />,
  );
  expect(screen.getByText(pl.soreness.none)).toBeTruthy();
  await view.rerender(
    <ActiveReports asOf="2026-10-07" constraints={constraints} busy onRevoke={revoke} />,
  );
  await fireEvent.press(screen.getByLabelText(/Odwołaj zgłoszenie:.*klatka/));
  expect(revoke).not.toHaveBeenCalled();
});

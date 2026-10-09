import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlanChangeBanner } from '@/features/plan/PlanChangeBanner';
import type { PlanBanner } from '@/db/repositories/weekPlan';
import { formatDate } from '@/lib/format';

it('shows every changed date in calendar details and can dismiss the generation', async () => {
  const onClose = jest.fn();
  const banner: PlanBanner = {
    id: 'generation',
    trigger: 'constraint',
    createdAt: '2026-10-07T10:00:00Z',
    changes: Array.from({ length: 6 }, (_, i) => ({
      date: `2026-10-${String(8 + i).padStart(2, '0')}`,
      before: ['push'],
      after: null,
      reasons: [],
    })),
  };
  await render(<PlanChangeBanner expanded banner={banner} onClose={onClose} />);
  for (const change of banner.changes)
    expect(
      screen.getByText(new RegExp(formatDate(change.date).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    ).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Zamknij'));
  expect(onClose).toHaveBeenCalledWith('generation');
});

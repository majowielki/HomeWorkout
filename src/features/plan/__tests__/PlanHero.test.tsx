import { render, screen } from '@testing-library/react-native';

import type { SessionPlan } from '@/domain/plan/types';

import { PlanHero } from '../PlanHero';
import type { usePlanToday } from '../usePlanToday';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

const plan = (date: string, regions: SessionPlan['regions']): SessionPlan => ({
  version: 1,
  date,
  blockIndex: 1,
  phase: 'work',
  regions,
  bike: { minutes: 12, resistance: 3, reasons: [] },
  exercises: [],
  skipped: [],
  dayReasons: [],
  signals: [],
  estimatedMinutes: 22,
  adjustments: [],
});

type Today = ReturnType<typeof usePlanToday>;

const today = (patch: Partial<Extract<Today['state'], { status: 'ready' }>>): Today => ({
  state: {
    status: 'ready',
    asOf: '2026-10-07',
    blockId: 'b',
    plan: plan('2026-10-07', ['lower', 'arms']),
    events: [],
    volume: {} as never,
    done: false,
    recovery: [],
    tomorrow: null,
    ...patch,
  },
  starting: false,
  start: jest.fn(async () => undefined),
  reload: jest.fn(async () => undefined),
});

describe('PlanHero', () => {
  it('names the day of the plan and offers to start it', async () => {
    await render(<PlanHero today={today({})} exerciseMap={{}} />);
    expect(screen.getByText(/^Plan na dziś · /)).toBeTruthy();
    expect(screen.getByText('Nogi + ramiona')).toBeTruthy();
    expect(screen.getByText('Rozpocznij plan')).toBeTruthy();
  });

  it('once today is done, shows what rests and tomorrow without a start button', async () => {
    await render(
      <PlanHero
        today={today({
          done: true,
          recovery: [
            { muscle: 'quads', lastWorked: '2026-10-07', readyOn: '2026-10-09' },
            { muscle: 'glutes', lastWorked: '2026-10-07', readyOn: '2026-10-09' },
          ],
          plan: plan('2026-10-07', []),
          tomorrow: plan('2026-10-08', ['push', 'pull']),
        })}
        exerciseMap={{}}
      />,
    );
    expect(screen.getByText('Dziś zrobione')).toBeTruthy();
    expect(screen.getByText('Czas na regenerację')).toBeTruthy();
    expect(screen.getByText('czworogłowe, pośladki')).toBeTruthy();
    expect(screen.getByText(/^Plan na jutro · /)).toBeTruthy();
    expect(screen.getByText('Pchanie + przyciąganie')).toBeTruthy();
    expect(screen.queryByText('Rozpocznij plan')).toBeNull();
    expect(screen.queryByText('Lekki dzień')).toBeNull();
  });

  it('says nothing needs a rest after a light day', async () => {
    await render(
      <PlanHero
        today={today({ done: true, tomorrow: plan('2026-10-08', ['lower']) })}
        exerciseMap={{}}
      />,
    );
    expect(screen.getByText(/żadna partia nie potrzebuje przerwy/)).toBeTruthy();
  });
});

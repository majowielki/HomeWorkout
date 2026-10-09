import { fireEvent, render, screen } from '@testing-library/react-native';

import { compileInput, exposure, set, stamp } from '@/domain/__tests__/compileFixtures';
import { compileSession } from '@/domain/plan/compile';
import type { SlotRegion } from '@/domain/plan/types';

import { PlanHero } from '../PlanHero';
import type { usePlanToday } from '../usePlanToday';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

const slotByRegion = {
  lower: 'squat',
  arms: 'biceps',
  push: 'push-horizontal',
  pull: 'pull-horizontal',
  shoulders: 'lateral-delts',
  core: 'core-back',
  mobility: 'mobility-upper',
};
const plan = (date: string, regions: SlotRegion[]) =>
  stamp(
    compileSession(
      compileInput(
        regions.map((region, i) =>
          exposure(String(i), { slotId: slotByRegion[region], sets: [set()] }),
        ),
        { trainingDate: date },
      ),
    ),
  );

type Today = ReturnType<typeof usePlanToday>;

const today = (patch: Partial<Extract<Today['state'], { status: 'ready' }>>): Today => ({
  state: {
    status: 'ready',
    asOf: '2026-10-07',
    preview: {
      output: {
        result: { kind: 'ready', plan: plan('2026-10-07', ['lower']), changes: [], notes: [] },
      },
    } as never,
    summary: {
      phase: 'work',
      regions: [],
      composed: false,
      estimatedMinutes: 22,
      dayReasons: [],
      skipped: [],
      blockIndex: 1,
    },
    plan: plan('2026-10-07', ['lower', 'arms']),
    events: [],
    volume: {} as never,
    done: false,
    recovery: [],
    tomorrow: null,
    bike: { minutes: 12, resistance: 3, reasons: [] },
    rest: false,
    week: [],
    banner: null,
    ...patch,
  },
  starting: false,
  start: jest.fn(async () => undefined),
  reload: jest.fn(async () => undefined),
  recalculate: jest.fn(async () => undefined),
  dismissBanner: jest.fn(async () => undefined),
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
    expect(screen.getByText('Dodatkowy trening')).toBeTruthy();
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

  it('on a rest day, says so and shows the next training day without a start button', async () => {
    const next = plan('2026-10-09', ['push']);
    await render(
      <PlanHero
        today={today({
          plan: null,
          rest: true,
          week: [
            { date: '2026-10-07', selection: null, forecast: null, status: 'planned' },
            { date: '2026-10-08', selection: null, forecast: null, status: 'planned' },
            { date: '2026-10-09', selection: null, forecast: next, status: 'planned' },
          ],
        })}
        exerciseMap={{}}
      />,
    );
    expect(screen.getByText('Dziś odpoczywasz')).toBeTruthy();
    expect(screen.getByText(/^Następny trening · /)).toBeTruthy();
    expect(screen.getByText('Pchanie')).toBeTruthy();
    expect(screen.queryByText('Rozpocznij plan')).toBeNull();
  });

  it('shows what the last replanning changed until it is closed', async () => {
    const t = today({
      banner: {
        id: 'g1',
        trigger: 'missed_day',
        createdAt: '2026-10-07T06:00:00.000Z',
        changes: [
          { date: '2026-10-08', before: ['lower'], after: ['pull'], reasons: [] },
          { date: '2026-10-09', before: ['push'], after: null, reasons: ['REST_DAY'] },
        ],
      },
    });
    await render(<PlanHero today={t} exerciseMap={{}} />);
    expect(screen.getByText('Plan tygodnia się zmienił')).toBeTruthy();
    expect(screen.getByText(/Pominięta sesja/)).toBeTruthy();
    expect(screen.getByText(/Nogi → Przyciąganie$/)).toBeTruthy();
    expect(screen.getByText(/Pchanie → wolne$/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Zamknij'));
    expect(t.dismissBanner).toHaveBeenCalledWith('g1');
  });
});

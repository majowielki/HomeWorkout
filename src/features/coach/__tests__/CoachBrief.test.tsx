import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { buildCoachContext } from '@/ai/context/buildCoachContext';
import { scenario } from '@/ai/testing/synthetic';

import { CoachBrief } from '../CoachBrief';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const setString = jest.mocked(Clipboard.setStringAsync);

const built = (spec: Parameters<typeof scenario>[0] = {}) => buildCoachContext(scenario(spec));

describe('CoachBrief', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setString.mockClear();
    setString.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('says what the brief holds', async () => {
    await render(<CoachBrief built={built({ weight: { startKg: 96, perWeekKg: -0.6 } })} />);
    expect(screen.getByText(/9 sesji · 28 ważeń · 0 notatek/)).toBeTruthy();
  });

  it('warns that data is thin only when it is', async () => {
    await render(<CoachBrief built={built({ sessions: 2, olderSessions: 0 })} />);
    expect(screen.getByText(/Mało danych/)).toBeTruthy();
  });

  it('is quiet about thin data when there is plenty', async () => {
    await render(<CoachBrief built={built()} />);
    expect(screen.queryByText(/Mało danych/)).toBeNull();
  });

  describe('copying', () => {
    it('puts the prompt and the brief on the clipboard together', async () => {
      await render(<CoachBrief built={built()} />);
      await fireEvent.press(screen.getByText('Kopiuj prompt i brief'));

      expect(setString).toHaveBeenCalledTimes(1);
      const text = setString.mock.calls[0]![0];
      expect(text.indexOf('<role>')).toBeLessThan(text.indexOf('<coach_context>'));
      expect(text).toContain('Podsumowanie');
      expect(text).toContain('"historicalSessionCount":29');
    });

    it('copies the prompt alone', async () => {
      await render(<CoachBrief built={built()} />);
      await fireEvent.press(screen.getByText('Kopiuj prompt'));

      const text = setString.mock.calls[0]![0];
      expect(text).toContain('<medical_guardrail>');
      expect(text).not.toContain('<coach_context>\n');
    });

    it('copies the brief alone', async () => {
      await render(<CoachBrief built={built()} />);
      await fireEvent.press(screen.getByText('Kopiuj brief'));

      const text = setString.mock.calls[0]![0];
      expect(text.startsWith('<coach_context>\n')).toBe(true);
      expect(text).not.toContain('<role>');
    });

    it('confirms, then goes back to the label', async () => {
      await render(<CoachBrief built={built()} />);
      await fireEvent.press(screen.getByText('Kopiuj brief'));
      expect(await screen.findByText('Skopiowano')).toBeTruthy();

      await act(() => jest.advanceTimersByTime(2100));
      expect(screen.getAllByText('Kopiuj brief')).toHaveLength(1);
    });

    it('says so when the clipboard refuses', async () => {
      setString.mockRejectedValueOnce(new Error('denied'));
      await render(<CoachBrief built={built()} />);
      await fireEvent.press(screen.getByText('Kopiuj prompt'));
      expect(await screen.findByText('Nie udało się skopiować.')).toBeTruthy();
    });
  });

  describe('what was held back', () => {
    const injury = { daysAgo: 1, source: 'daily' as const, text: 'kolano strzyka przy schodach' };
    const diet = { daysAgo: 2, source: 'daily' as const, text: 'ile kalorii dziś' };

    it('names withheld injury notes and gives the one fixed sentence', async () => {
      await render(<CoachBrief built={built({ notes: [injury] })} />);
      expect(
        screen.getByText(/Pominięto 1 notatkę, które wspominają o bólu lub urazie/),
      ).toBeTruthy();
      expect(screen.getByText('Dolegliwości omów z fizjoterapeutą lub lekarzem.')).toBeTruthy();
    });

    it('names withheld diet and medication notes', async () => {
      await render(<CoachBrief built={built({ notes: [diet] })} />);
      expect(screen.getByText(/Pominięto 1 notatkę o diecie lub leku/)).toBeTruthy();
    });

    it('never puts the withheld text on the clipboard', async () => {
      await render(<CoachBrief built={built({ notes: [injury, diet] })} />);
      await fireEvent.press(screen.getByText('Kopiuj prompt i brief'));
      const text = setString.mock.calls[0]![0];
      expect(text).not.toContain('strzyka');
      expect(text).not.toContain('kalorii');
    });

    it('is silent when nothing was withheld', async () => {
      await render(<CoachBrief built={built()} />);
      expect(screen.queryByText(/Pominięto/)).toBeNull();
    });
  });
});

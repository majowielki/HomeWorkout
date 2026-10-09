import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { pl } from '@/strings/pl';

import SessionSummaryScreen from '../../../../app/workout/summary/[id]';

const mockReplace = jest.fn();
const mockClose = jest.fn();

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ id: 'w1' }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'cmd-1' }));
jest.mock('@/lib/reminders', () => ({ syncReminders: jest.fn(async () => undefined) }));
jest.mock('@/features/glossary/GlossaryButton', () => ({ GlossaryButton: () => null }));
jest.mock('@/db/repositories/sessions', () => ({
  closeSession: (...args: unknown[]) => mockClose(...args),
  undoSet: jest.fn(),
  readSessionState: () => ({
    workout: { status: 'in_progress', startedAt: new Date(2026, 9, 5).toISOString() },
    plan: { exposures: [], time: { exerciseTotal: 0 } },
    results: new Map(),
    records: [],
  }),
}));

beforeEach(() => jest.clearAllMocks());

it('says so when the workout cannot be finished, and stays on the summary', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockClose.mockReturnValue({ kind: 'conflict', code: 'SESSION_CHANGED', actualRevision: 3 });
  await render(<SessionSummaryScreen />);
  await fireEvent.press(screen.getByText(pl.workout.summary.finish));
  expect(mockClose).toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(pl.common.error);
  expect(mockReplace).not.toHaveBeenCalled();
});

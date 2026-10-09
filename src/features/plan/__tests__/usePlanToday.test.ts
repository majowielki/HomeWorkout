import { act, renderHook } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';
import { Alert } from 'react-native';
import { acceptDay } from '@/db/repositories/planning';
import { markChangesSeen } from '@/db/repositories/weekPlan';
import { readToday, type PlanToday } from '../today';
import { usePlanToday } from '../usePlanToday';

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void) => {
    mockUseEffect(callback, [callback]);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'command' }));
jest.mock('../today', () => ({ readToday: jest.fn() }));
jest.mock('@/db/repositories/planning', () => ({ acceptDay: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({ markChangesSeen: jest.fn() }));
const day = {
  plan: { sessionId: 'shown' },
  preview: { request: { sessionId: 'shown' }, planHash: 'hash' },
} as PlanToday;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readToday).mockReturnValue(day);
  jest
    .mocked(acceptDay)
    .mockReturnValue({ kind: 'committed', result: { sessionId: 'started' }, sessionRevision: 1 });
});
it('starts exactly the preview that was shown and navigates only after acceptance', async () => {
  const { result } = await renderHook(() => usePlanToday());
  expect(result.current.state.status).toBe('ready');
  await act(() => result.current.start());
  await act(() => result.current.start());
  expect(acceptDay).toHaveBeenCalledTimes(1);
  expect(acceptDay).toHaveBeenCalledWith(
    expect.objectContaining({ request: { sessionId: 'shown' }, expectedPlanHash: 'hash' }),
  );
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/workout/active/[id]',
    params: { id: 'started' },
  });
});
it('refreshes a stale preview and stays on the plan screen', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest
    .mocked(acceptDay)
    .mockReturnValue({ kind: 'conflict', code: 'STALE_INPUT', actualRevision: null });
  const { result } = await renderHook(() => usePlanToday());
  await act(() => result.current.start());
  expect(readToday).toHaveBeenCalledTimes(2);
  expect(mockPush).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalled();
  alert.mockRestore();
});
it('does not start a day without a plan, and sends explicit recalculation and dismiss requests', async () => {
  jest.mocked(readToday).mockReturnValue({ ...day, plan: null });
  const { result } = await renderHook(() => usePlanToday());
  await act(() => result.current.start());
  expect(acceptDay).not.toHaveBeenCalled();
  await act(() => result.current.recalculate());
  expect(readToday).toHaveBeenCalledWith({ trigger: 'manual' });
  await act(() => result.current.dismissBanner('generation'));
  expect(markChangesSeen).toHaveBeenCalledWith('generation');
});
it('recovers from a failed load on retry', async () => {
  jest.mocked(readToday).mockImplementationOnce(() => {
    throw new Error('read failed');
  });
  const { result } = await renderHook(() => usePlanToday());
  expect(result.current.state.status).toBe('error');
  await act(() => result.current.reload());
  expect(result.current.state.status).toBe('ready');
});

import { renderHook } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { useLeaveGuard } from '../useLeaveGuard';

const mockDispatch = jest.fn();
let mockPrevent: { enabled: boolean; callback: (e: { data: { action: unknown } }) => void } | null =
  null;

jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (enabled: boolean, callback: (e: { data: { action: unknown } }) => void) => {
    mockPrevent = { enabled, callback };
  },
}));

const BACK = { type: 'GO_BACK' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function leave(): AlertButton[] {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockPrevent!.callback({ data: { action: BACK } });
  const buttons = alert.mock.calls.at(-1)?.[2] ?? [];
  alert.mockRestore();
  return buttons;
}

const button = (buttons: AlertButton[], text: string) => buttons.find((b) => b.text === text)!;

beforeEach(() => {
  mockDispatch.mockClear();
  mockPrevent = null;
});

describe('useLeaveGuard', () => {
  it('blocks leaving only while there are unsaved changes', async () => {
    const { rerender } = await renderHook(
      ({ dirty }: { dirty: boolean }) => useLeaveGuard(dirty, async () => true),
      { initialProps: { dirty: false } },
    );
    expect(mockPrevent!.enabled).toBe(false);
    await rerender({ dirty: true });
    expect(mockPrevent!.enabled).toBe(true);
  });

  it('stays on "Zostań" and leaves on "Odrzuć"', async () => {
    await renderHook(() => useLeaveGuard(true, async () => true));
    const buttons = leave();
    expect(buttons.map((b) => b.text)).toEqual(['Zostań', 'Odrzuć', 'Zapisz']);
    expect(mockDispatch).not.toHaveBeenCalled();
    button(buttons, 'Odrzuć').onPress!();
    expect(mockDispatch).toHaveBeenCalledWith(BACK);
  });

  it('leaves after "Zapisz" only when saving succeeded', async () => {
    const save = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderHook(() => useLeaveGuard(true, save));

    button(leave(), 'Zapisz').onPress!();
    await flush();
    expect(mockDispatch).not.toHaveBeenCalled();

    button(leave(), 'Zapisz').onPress!();
    await flush();
    expect(mockDispatch).toHaveBeenCalledWith(BACK);
  });

  it('lets the screen leave after its own save without asking', async () => {
    const { result } = await renderHook(() => useLeaveGuard(true, async () => true));
    result.current.allowLeave();
    const alert = jest.spyOn(Alert, 'alert');
    mockPrevent!.callback({ data: { action: BACK } });
    expect(alert).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(BACK);
    alert.mockRestore();
  });
});

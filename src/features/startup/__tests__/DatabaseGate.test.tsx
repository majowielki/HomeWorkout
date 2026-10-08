import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { type DatabaseStartup, useDatabaseStartup } from '@/db/startup';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';
import { DatabaseGate } from '../DatabaseGate';

jest.mock('@/db/startup', () => ({ useDatabaseStartup: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ syncReminders: jest.fn() }));

async function renderWith(startup: DatabaseStartup) {
  jest.mocked(useDatabaseStartup).mockReturnValue(startup);
  await render(
    <DatabaseGate>
      <Text>app</Text>
    </DatabaseGate>,
  );
}

beforeEach(() => jest.mocked(syncReminders).mockResolvedValue(undefined));

it('waits for the database and schedules nothing yet', async () => {
  await renderWith({ status: 'loading' });
  expect(screen.getByText(pl.common.loading)).toBeTruthy();
  expect(screen.queryByText('app')).toBeNull();
  expect(syncReminders).not.toHaveBeenCalled();
});

it('shows why the database could not start', async () => {
  await renderWith({ status: 'failed', error: new Error('migration 0007 failed') });
  expect(screen.getByText('migration 0007 failed')).toBeTruthy();
  expect(screen.queryByText('app')).toBeNull();
});

it('opens the app and recomputes reminders, whose failure never blocks it', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.mocked(syncReminders).mockRejectedValue(new Error('no permission'));
  await renderWith({ status: 'ready' });
  expect(screen.getByText('app')).toBeTruthy();
  await waitFor(() => expect(warn).toHaveBeenCalledWith('reminder sync failed', expect.any(Error)));
  warn.mockRestore();
});

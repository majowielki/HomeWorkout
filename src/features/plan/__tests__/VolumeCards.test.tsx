import { fireEvent, render, screen } from '@testing-library/react-native';

import type { VolumeCard } from '@/domain/volume/lever';
import { pl } from '@/strings/pl';

import { VolumeCards } from '../VolumeCards';

jest.mock('@/db/repositories/volumeLever', () => ({
  readVolumeCards: jest.fn(() => []),
  acceptVolumeCard: jest.fn(() => true),
}));

const t = pl.plan.volumeLever;
const more: VolumeCard = {
  muscle: 'shoulders',
  change: 'increase',
  fromMax: 6,
  toMax: 8,
  reasons: ['STALLED_WELL_RECOVERED'],
};
const less: VolumeCard = {
  muscle: 'quads',
  change: 'decrease',
  fromMax: 8,
  toMax: 6,
  reasons: ['RECOVERY_LOW', 'FREQUENT_SORENESS'],
};

describe('the volume lever cards', () => {
  it('shows nothing when the engine has no card', async () => {
    const { toJSON } = await render(<VolumeCards onChanged={jest.fn()} read={() => []} />);
    expect(toJSON()).toBeNull();
  });

  it('offers more or less with the reason and the two maxima, and takes a card with one touch', async () => {
    const onChanged = jest.fn();
    const accept = jest.fn(() => true);
    let cards = [more, less];
    await render(<VolumeCards onChanged={onChanged} read={() => cards} accept={accept} />);
    expect(screen.getByText(t.moreTitle(pl.labels.muscle.shoulders))).toBeTruthy();
    expect(screen.getByText(t.lessTitle(pl.labels.muscle.quads))).toBeTruthy();
    expect(screen.getByText(`${t.reason.STALLED_WELL_RECOVERED} ${t.change(6, 8)}`)).toBeTruthy();
    cards = [less];
    await fireEvent.press(screen.getByText(t.raise));
    expect(accept).toHaveBeenCalledWith(more);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.moreTitle(pl.labels.muscle.shoulders))).toBeNull();
  });

  it('leaves a card it was told not now, and does not bring it back', async () => {
    const accept = jest.fn(() => true);
    const view = await render(
      <VolumeCards onChanged={jest.fn()} read={() => [less]} accept={accept} />,
    );
    await fireEvent.press(screen.getByText(t.notNow));
    expect(accept).not.toHaveBeenCalled();
    expect(screen.queryByText(t.lower)).toBeNull();
    await view.unmount();
    await render(<VolumeCards onChanged={jest.fn()} read={() => [less]} accept={accept} />);
    expect(screen.queryByText(t.lower)).toBeNull();
  });

  it('says so when the card is no longer the engine’s, or storing it failed', async () => {
    const onChanged = jest.fn();
    const accept = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockImplementationOnce(() => {
        throw new Error('locked');
      });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<VolumeCards onChanged={onChanged} read={() => [more]} accept={accept} />);
    await fireEvent.press(screen.getByText(t.raise));
    expect(screen.getByText(t.error)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.raise));
    expect(screen.getByText(t.error)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('hides the lever when it cannot be worked out, and nothing else', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { toJSON } = await render(
      <VolumeCards
        onChanged={jest.fn()}
        read={() => {
          throw new Error('no history');
        }}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});

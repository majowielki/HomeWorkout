import { act, render, screen } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';

import { ExerciseVideo } from '../ExerciseVideo';

jest.mock('@/assets/ymove-media', () => ({
  ymoveMedia: {
    'goblet-squat': { video: 101, bodyMap: 102, info: {} },
  },
}));

// A screen's own focus and blur events, which the clip follows.
const mockListeners: Record<string, () => void> = {};
const mockUnsubscribe = jest.fn();
const mockNavigation = {
  addListener: (event: string, handler: () => void) => {
    mockListeners[event] = handler;
    return mockUnsubscribe;
  },
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

const mockedPlayer = jest.mocked(useVideoPlayer);
type FakePlayer = { loop: boolean; muted: boolean; play: jest.Mock; pause: jest.Mock };
const lastPlayer = () => mockedPlayer.mock.results.at(-1)!.value as FakePlayer;

describe('ExerciseVideo', () => {
  beforeEach(() => {
    mockedPlayer.mockClear();
    mockUnsubscribe.mockClear();
  });

  it('plays the clip muted and looping, with no controls', async () => {
    await render(
      <ExerciseVideo exerciseId="goblet-squat" mediaKey={null} name="Przysiad goblet" />,
    );

    const frame = screen.getByLabelText('Film pokazujący: Przysiad goblet');
    expect(mockedPlayer).toHaveBeenCalledWith(101, expect.any(Function));

    const player = lastPlayer();
    expect(player.loop).toBe(true);
    expect(player.muted).toBe(true);
    expect(player.play).toHaveBeenCalled();

    const view = frame.children[0] as unknown as {
      type: string;
      props: { nativeControls: boolean };
    };
    expect(view.type).toBe('VideoView');
    expect(view.props.nativeControls).toBe(false);
  });

  it('pauses when its screen loses focus and plays again when it returns', async () => {
    await render(
      <ExerciseVideo exerciseId="goblet-squat" mediaKey={null} name="Przysiad goblet" />,
    );
    const player = lastPlayer();
    player.play.mockClear();

    await act(() => mockListeners.blur!());
    expect(player.pause).toHaveBeenCalledTimes(1);

    await act(() => mockListeners.focus!());
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('leaves the pausing alone on unmount: the player is already released by then', async () => {
    const { unmount } = await render(
      <ExerciseVideo exerciseId="goblet-squat" mediaKey={null} name="Przysiad goblet" />,
    );
    const player = lastPlayer();

    await unmount();

    // Pausing a released expo-video player throws, which crashed the screen on device.
    expect(player.pause).not.toHaveBeenCalled();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  });

  it('falls back to the photo placeholder when the exercise has no clip', async () => {
    await render(<ExerciseVideo exerciseId="no-such-exercise" mediaKey={null} name="Nic" />);

    expect(screen.getByLabelText('Brak zdjęcia')).toBeTruthy();
    expect(mockedPlayer).not.toHaveBeenCalled();
  });
});

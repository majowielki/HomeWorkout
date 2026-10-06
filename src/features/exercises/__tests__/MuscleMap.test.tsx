import { render, screen } from '@testing-library/react-native';

import { MuscleMap } from '../MuscleMap';

jest.mock('@/assets/ymove-media', () => ({
  ymoveMedia: {
    'goblet-squat': { video: 101, bodyMap: 102, info: {} },
  },
}));

jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));

describe('MuscleMap', () => {
  it('draws the muscles worked, front and back, with a legend', async () => {
    await render(<MuscleMap exerciseId="goblet-squat" name="Przysiad goblet" />);

    const image = screen.getByLabelText('Mięśnie zaangażowane w: Przysiad goblet');
    expect(image.props.source).toBe(102);
    expect(screen.getByText('Przód')).toBeTruthy();
    expect(screen.getByText('Tył')).toBeTruthy();
    expect(screen.getByText('Główne')).toBeTruthy();
    expect(screen.getByText('Pomocnicze')).toBeTruthy();
  });

  it('renders nothing for an exercise without a clip', async () => {
    await render(<MuscleMap exerciseId="no-such-exercise" name="Nic" />);

    expect(screen.queryByText('Główne')).toBeNull();
  });
});

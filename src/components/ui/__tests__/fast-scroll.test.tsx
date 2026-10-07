import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { FastScroll } from '../fast-scroll';

const RAIL = 448; // THUMB 48 + 400 of travel
const touch = (pageY: number, locationY = pageY) => ({ nativeEvent: { pageY, locationY } });

async function renderRail(props: Partial<Parameters<typeof FastScroll>[0]> = {}) {
  const onScrollTo = jest.fn();
  await render(
    <View testID="host">
      <FastScroll
        contentHeight={3000}
        viewportHeight={600}
        offset={0}
        onScrollTo={onScrollTo}
        label="Przysiad"
        {...props}
      />
    </View>,
  );
  return onScrollTo;
}

/** The rail is the host's only child; give it a height the way a layout pass would. */
async function layoutRail() {
  const rail = screen.getByTestId('host').children[0] as Parameters<typeof fireEvent>[0];
  await act(async () => {
    fireEvent(rail, 'layout', { nativeEvent: { layout: { height: RAIL } } });
  });
  return rail;
}

describe('FastScroll', () => {
  it('stays out of the way for a short list', async () => {
    await renderRail({ contentHeight: 900 });
    expect(screen.getByTestId('host').children).toHaveLength(0);
  });

  it('maps a drag along the rail onto the whole list', async () => {
    const onScrollTo = await renderRail();
    const rail = await layoutRail();

    await act(async () => {
      fireEvent(rail, 'responderGrant', touch(124)); // 24 = half a thumb, +100 of 400
    });
    expect(onScrollTo).toHaveBeenLastCalledWith(600); // a quarter of 2400
    expect(screen.getByText('Przysiad', { includeHiddenElements: true })).toBeTruthy();

    await act(async () => {
      fireEvent(rail, 'responderMove', touch(10_000, 0)); // far below the rail
    });
    expect(onScrollTo).toHaveBeenLastCalledWith(2400);

    await act(async () => {
      fireEvent(rail, 'responderRelease', touch(0));
    });
    expect(screen.queryByText('Przysiad', { includeHiddenElements: true })).toBeNull();
  });
});

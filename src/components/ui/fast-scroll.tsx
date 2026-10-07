import { useRef, useState } from 'react';
import { type GestureResponderEvent, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type Props = {
  /** Full height of the list's content and of its visible window, in dp. */
  contentHeight: number;
  viewportHeight: number;
  /** Current scroll offset. */
  offset: number;
  /** Jump the list to this offset (no animation: it follows the finger). */
  onScrollTo: (offset: number) => void;
  /** Shown next to the thumb while dragging, e.g. the section under it. */
  label?: string | null;
};

const THUMB = 48;
const INSET = 8;
/** Below this many screens of content a plain swipe is quick enough. */
const MIN_SCREENS = 2;

/**
 * A grabbable scrollbar on the right edge, like Android's fast scroller:
 * drag the thumb (or touch anywhere on the rail) to jump through a long
 * list. React Native's lists have no such thing built in.
 */
export function FastScroll({ contentHeight, viewportHeight, offset, onScrollTo, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const [railHeight, setRailHeight] = useState(0);
  // Page y of the rail's top, taken when a drag starts: pageY stays steady
  // while the finger wanders off the rail, locationY does not.
  const railTop = useRef(0);

  const scrollable = contentHeight - viewportHeight;
  if (viewportHeight <= 0 || contentHeight < viewportHeight * MIN_SCREENS) return null;

  const room = Math.max(1, railHeight - THUMB);
  const follow = (y: number) => {
    const ratio = Math.min(1, Math.max(0, (y - THUMB / 2) / room));
    onScrollTo(ratio * Math.max(0, scrollable));
  };
  const end = () => setDragging(false);
  const top = scrollable > 0 ? (Math.min(Math.max(offset, 0), scrollable) / scrollable) * room : 0;

  return (
    <View
      className="absolute right-0 w-10"
      style={{ top: INSET, bottom: INSET }}
      onLayout={(e) => setRailHeight(e.nativeEvent.layout.height)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e: GestureResponderEvent) => {
        railTop.current = e.nativeEvent.pageY - e.nativeEvent.locationY;
        setDragging(true);
        follow(e.nativeEvent.locationY);
      }}
      onResponderMove={(e: GestureResponderEvent) => follow(e.nativeEvent.pageY - railTop.current)}
      onResponderRelease={end}
      onResponderTerminate={end}
    >
      <View pointerEvents="none" className="absolute right-1.5" style={{ top, height: THUMB }}>
        <View
          className={cn(
            'h-full rounded-full',
            dragging ? 'w-2 bg-primary' : 'w-1.5 bg-muted-foreground/50',
          )}
        />
      </View>
      {dragging && label ? (
        <View
          pointerEvents="none"
          className="absolute right-10 rounded-2xl bg-foreground px-4 py-2"
          style={{ top: Math.max(0, top + THUMB / 2 - 20) }}
        >
          <Text className="font-display-semibold text-background">{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

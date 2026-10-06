import { useNavigation } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { View } from 'react-native';

import { ymoveMedia } from '@/assets/ymove-media';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

import { ExerciseThumb } from './ExerciseThumb';

type Props = {
  exerciseId: string;
  /** Photo key to fall back on when there is no clip for the exercise. */
  mediaKey: string | null;
  /** For the screen reader. */
  name: string;
  /** Sets the size; the clip is portrait (9:16), so `aspect-[9/16]` leaves no bars. */
  className?: string;
};

/**
 * The exercise as a muted, looping clip — what to do at a glance, with no
 * controls to fumble for mid-set. Falls back to the still photo (or the
 * placeholder) when YMove's clip is not part of this build.
 */
export function ExerciseVideo({ exerciseId, mediaKey, name, className }: Props) {
  const entry = ymoveMedia[exerciseId];
  if (!entry) return <ExerciseThumb mediaKey={mediaKey} className={className} />;
  return <LoopingClip source={entry.video} name={name} className={className} />;
}

function LoopingClip({
  source,
  name,
  className,
}: {
  source: number;
  name: string;
  className?: string;
}) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Screens stacked underneath stay mounted; only the visible one should decode.
  // Not useFocusEffect: its cleanup also runs on unmount, after useVideoPlayer
  // has already released the player, and pausing a released player throws.
  // Unmounting needs no pause, so only a real blur stops the clip.
  const navigation = useNavigation();
  useEffect(() => {
    const unfocus = navigation.addListener('focus', () => player.play());
    const unblur = navigation.addListener('blur', () => player.pause());
    return () => {
      unfocus();
      unblur();
    };
  }, [navigation, player]);

  return (
    <View
      className={cn('overflow-hidden rounded-2xl bg-secondary', className)}
      accessible
      accessibilityLabel={pl.a11y.exerciseVideo(name)}
    >
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        // A SurfaceView ignores the rounded clip and misdraws inside a ScrollView.
        surfaceType="textureView"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

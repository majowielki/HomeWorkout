import { useNavigation } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ymoveMedia } from '@/assets/ymove-media';
import { Maximize2, X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
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
  /**
   * A tap opens the clip (or the photo) over the whole screen — on the
   * floor, a small clip is hard to read. Another tap or "back" closes it.
   */
  zoomable?: boolean;
};

/**
 * The exercise as a muted, looping clip — what to do at a glance, with no
 * controls to fumble for mid-set. Falls back to the still photo (or the
 * placeholder) when YMove's clip is not part of this build.
 */
export function ExerciseVideo({ exerciseId, mediaKey, name, className, zoomable }: Props) {
  const [zoomed, setZoomed] = useState(false);
  const entry = ymoveMedia[exerciseId];
  const media = entry ? (
    <LoopingClip source={entry.video} name={name} className={className} paused={zoomed} />
  ) : (
    <ExerciseThumb mediaKey={mediaKey} className={className} />
  );
  if (!zoomable) return media;

  return (
    <>
      <Pressable
        onPress={() => setZoomed(true)}
        accessibilityRole="button"
        accessibilityLabel={pl.a11y.zoomExercise(name)}
        className="active:opacity-80"
      >
        {media}
        <View className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1.5">
          <Maximize2 size={14} className="text-white" />
        </View>
      </Pressable>
      {zoomed ? (
        <ZoomedMedia
          source={entry?.video}
          mediaKey={mediaKey}
          name={name}
          onClose={() => setZoomed(false)}
        />
      ) : null}
    </>
  );
}

function ZoomedMedia({
  source,
  mediaKey,
  name,
  onClose,
}: {
  source: number | undefined;
  mediaKey: string | null;
  name: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel={pl.common.close}
        className="flex-1 items-center justify-center bg-black"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {source !== undefined ? (
          <LoopingClip source={source} name={name} className="aspect-[9/16] h-full max-w-full" />
        ) : (
          <ExerciseThumb mediaKey={mediaKey} className="aspect-square w-full" />
        )}
        <View
          className="absolute right-4 rounded-full bg-black/60 p-2"
          style={{ top: insets.top + 12 }}
        >
          <X size={24} className="text-white" />
        </View>
        <Text
          className="absolute left-4 right-4 text-center font-display-semibold text-lg text-white"
          style={{ bottom: insets.bottom + 16 }}
        >
          {name}
        </Text>
      </Pressable>
    </Modal>
  );
}

function LoopingClip({
  source,
  name,
  className,
  paused = false,
}: {
  source: number;
  name: string;
  className?: string;
  /** Held still while the same clip plays zoomed in on top of it. */
  paused?: boolean;
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

  // The body runs on mount and on a change of `paused`; there is no cleanup,
  // so nothing touches the player on unmount (same reason as above).
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused, player]);

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

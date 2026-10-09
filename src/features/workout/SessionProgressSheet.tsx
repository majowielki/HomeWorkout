import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { forwardRef, useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { SessionStep } from '@/domain/session/progress';
import type { Exercise } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

type Props = {
  steps: SessionStep[];
  currentIndex: number;
  exerciseMap: Record<string, Exercise>;
  onJump: (index: number) => void;
};

/**
 * Full-session overview. Jumping works onto the sets still to do and onto
 * skipped ones (going back to an exercise passed over); a set that has a
 * result is a dead end here — correcting it is "Cofnij serię".
 */
export const SessionProgressSheet = forwardRef<BottomSheet, Props>(function SessionProgressSheet(
  { steps, currentIndex, exerciseMap, onJump },
  ref,
) {
  const colors = useThemeColors();
  const snapPoints = useMemo(() => ['65%'], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      // gorhom takes raw style objects, not classes — hence the JS palette.
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        <Text variant="heading" className="mb-3">
          {pl.workout.session.progressTitle}
        </Text>
        {steps.map((step, index) => {
          const done = step.state === 'performed' || step.state === 'interrupted';
          const skipped = step.state === 'skipped';
          const isCurrent = index === currentIndex;
          const exercise = exerciseMap[step.exposure.exercise.id];

          return (
            <Pressable
              key={step.set.id}
              disabled={done}
              onPress={() => onJump(index)}
              className={cn(
                'flex-row items-center gap-3 rounded-2xl px-3 py-3',
                isCurrent && 'bg-secondary',
              )}
            >
              <View
                className={cn(
                  'h-6 w-6 items-center justify-center rounded-full border',
                  done ? 'border-primary bg-primary' : 'border-border',
                )}
              >
                {done ? <Check size={14} className="text-primary-foreground" /> : null}
              </View>
              <Text
                className={cn(
                  'flex-1',
                  done && 'text-muted-foreground line-through',
                  skipped && 'text-muted-foreground',
                )}
              >
                {step.label} · {exercise?.name ?? step.exposure.exercise.displayName} · #
                {step.round}
                {step.side ? ` · ${pl.workout.session.side[step.side]}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

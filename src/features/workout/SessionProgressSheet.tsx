import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { forwardRef, useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { SessionStep } from '@/domain/session/steps';
import { stepKey } from '@/domain/session/steps';
import type { Exercise } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

type Props = {
  steps: SessionStep[];
  currentIndex: number;
  loggedKeys: Set<string>;
  exerciseMap: Record<string, Exercise>;
  onJump: (index: number) => void;
};

/**
 * Full-session overview. Jumping only works onto not-yet-logged steps —
 * this is a deliberate M3 scope cut: jump/skip live only in memory, so an
 * app restart falls back to the first unlogged step (see SPEC §7.1). That
 * makes re-visiting an already-logged step here a dead end by design
 * rather than an editable one.
 */
export const SessionProgressSheet = forwardRef<BottomSheet, Props>(function SessionProgressSheet(
  { steps, currentIndex, loggedKeys, exerciseMap, onJump },
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
          const key = stepKey(step.blockIndex, step.setNumber);
          const done = loggedKeys.has(key);
          const isCurrent = index === currentIndex;
          const exercise = exerciseMap[step.block.exerciseId];

          return (
            <Pressable
              key={key}
              disabled={done}
              onPress={() => onJump(index)}
              className={cn(
                'flex-row items-center gap-3 rounded-xl px-2 py-2.5',
                isCurrent && 'bg-secondary',
              )}
            >
              <View
                className={cn(
                  'h-6 w-6 items-center justify-center rounded-full border',
                  done ? 'border-success bg-success' : 'border-border',
                )}
              >
                {done ? <Check size={14} className="text-white" /> : null}
              </View>
              <Text className={cn('flex-1', done && 'text-muted-foreground line-through')}>
                {step.block.label} · {exercise?.name ?? step.block.exerciseId} · #{step.setNumber}
              </Text>
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

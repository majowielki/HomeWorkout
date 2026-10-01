import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { buildCoachContext, type BuiltCoachContext } from '@/ai/context/buildCoachContext';
import { loadCoachSource } from '@/db/repositories/coachSource';

export type CoachBriefState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; built: BuiltCoachContext };

/**
 * The context a model would be given right now, rebuilt every time the
 * screen comes into focus: a weigh-in or a session logged in between must
 * show up in what "Copy" puts on the clipboard.
 */
export function useCoachBrief(): CoachBriefState {
  const [state, setState] = useState<CoachBriefState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadCoachSource()
        .then((source) => {
          if (!cancelled) setState({ status: 'ready', built: buildCoachContext(source) });
        })
        .catch((error: unknown) => {
          console.warn('coach brief failed', error);
          if (!cancelled) setState({ status: 'error' });
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return state;
}

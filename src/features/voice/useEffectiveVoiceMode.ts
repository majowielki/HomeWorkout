import { useEffect, useState } from 'react';

import { getVoiceMode, type VoiceMode } from '@/lib/voiceSettings';

import { recognitionMode } from './recognizer';

/**
 * The mode the session actually listens in: the chosen one, except that the
 * microphone is only left on with on-device recognition (the Polish offline
 * pack installed). Without it the session falls back to a tap per command,
 * and Settings says why. Null while the phone is being asked.
 */
export function useEffectiveVoiceMode(): VoiceMode | null {
  const [chosen] = useState(getVoiceMode);
  const [mode, setMode] = useState<VoiceMode | null>(chosen === 'tap' ? 'tap' : null);

  useEffect(() => {
    if (chosen === 'tap') return;
    let cancelled = false;
    void recognitionMode().then((recognition) => {
      if (!cancelled) setMode(recognition === 'on_device' ? chosen : 'tap');
    });
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  return mode;
}

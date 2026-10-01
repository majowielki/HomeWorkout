import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

type Props = {
  label: string;
  /** Called when pressed, so a long text is built only if it is wanted. */
  text: () => string;
  variant?: 'default' | 'outline';
};

/** Puts text on the clipboard and says so for two seconds. */
export function CopyButton({ label, text, variant = 'outline' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await Clipboard.setStringAsync(text());
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  const done = state === 'copied';
  return (
    <Button variant={variant} onPress={() => void copy()} accessibilityLabel={label}>
      {done ? <Check size={18} className="text-foreground" /> : null}
      <Text
        className={
          variant === 'default'
            ? 'font-semibold text-primary-foreground'
            : 'font-semibold text-foreground'
        }
      >
        {state === 'copied' ? pl.coach.copied : state === 'failed' ? pl.coach.copyFailed : label}
      </Text>
    </Button>
  );
}

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Info } from '@/components/ui/icons';
import { pl } from '@/strings/pl';

import { GlossaryModal } from './GlossaryModal';

type Props = { className?: string };

/** Self-contained "?" trigger for the glossary — drop it next to any FBW/RIR/RPE label. */
export function GlossaryButton({ className }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={className}
        accessibilityLabel={pl.glossary.trigger}
        onPress={() => setVisible(true)}
      >
        <Info size={18} className="text-muted-foreground" />
      </Button>
      <GlossaryModal visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

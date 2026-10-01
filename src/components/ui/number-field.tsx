import { View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

type Props = {
  /** Visible label; when omitted (the card already titles the field) it is still read out. */
  label?: string;
  accessibilityLabel?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  /** 'decimal' allows a comma/dot; 'integer' shows the plain number pad. */
  kind?: 'decimal' | 'integer';
  className?: string;
  inputClassName?: string;
};

/**
 * Labelled numeric input. Keeps the raw string so the user can type
 * "82," on the way to "82,5" — parse it with `parseDecimal` on submit.
 */
export function NumberField({
  label,
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  hint,
  kind = 'decimal',
  className,
  inputClassName,
}: Props) {
  return (
    <View className={className}>
      {label ? (
        <Text variant="eyebrow" className="mb-2">
          {label}
        </Text>
      ) : null}
      <Input
        className={inputClassName}
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={kind === 'decimal' ? 'decimal-pad' : 'number-pad'}
        inputMode={kind === 'decimal' ? 'decimal' : 'numeric'}
      />
      {hint ? (
        <Text variant="muted" className="mt-1 text-xs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Accepts both '82.5' and '82,5'; returns null for anything that is not a finite number. */
export function parseDecimal(text: string): number | null {
  const normalised = text.trim().replace(',', '.');
  if (normalised === '') return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/** Empty string for null so the field can be cleared. */
export function formatDecimal(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

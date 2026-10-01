import { Link } from 'expo-router';
import { View } from 'react-native';

import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Activity } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { coachConfig } from '@/lib/coach';
import { pl } from '@/strings/pl';

import { useAiEnabled } from './useAiEnabled';

/**
 * The AI switch. It takes effect at once and is not part of "Save
 * settings": it is a decision about sending data, and a decision like that
 * should not wait behind a button at the bottom of another form.
 */
export function AiSettingsCard() {
  const [enabled, setEnabled] = useAiEnabled();
  const s = pl.coach.ai.settings;

  return (
    <Card>
      <CardTitle>{s.section}</CardTitle>
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1">{s.toggle}</Text>
          <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel={s.toggle} />
        </View>
        <Text variant="muted" className="text-xs">
          {s.toggleHint}
        </Text>
        <Text variant="muted" className="text-xs">
          {coachConfig ? s.configured : s.notConfigured}
        </Text>
        <Link href="/coach/diagnostics" asChild>
          <ListRow icon={Activity} title={s.diagnostics} subtitle={s.diagnosticsHint} />
        </Link>
      </CardContent>
    </Card>
  );
}

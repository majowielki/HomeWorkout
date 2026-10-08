import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import {
  getVoiceEnabled,
  getVoiceMode,
  setVoiceEnabled,
  setVoiceMode,
  VOICE_MODES,
} from '@/lib/voiceSettings';
import { pl } from '@/strings/pl';

import { downloadPolishModel, type RecognitionMode, recognitionMode } from './recognizer';

/**
 * The microphone switch and where speech is turned into text. Like the AI
 * switch it takes effect at once, outside "Zapisz ustawienia".
 */
export function VoiceSettingsCard() {
  const [enabled, setEnabled] = useState(getVoiceEnabled);
  const [mode, setMode] = useState<RecognitionMode | null>(null);
  const [listening, setListening] = useState(getVoiceMode);
  const [download, setDownload] = useState<'started' | 'failed' | null>(null);
  const s = pl.voice.settings;

  useEffect(() => {
    let cancelled = false;
    void recognitionMode().then((m) => {
      if (!cancelled) setMode(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardTitle>{s.section}</CardTitle>
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1">{s.toggle}</Text>
          <Switch
            value={enabled}
            onValueChange={(next) => {
              setVoiceEnabled(next);
              setEnabled(next);
            }}
            accessibilityLabel={s.toggle}
          />
        </View>
        <Text variant="muted" className="text-xs">
          {s.toggleHint}
        </Text>
        <Text variant="muted" className="text-xs">
          {s.aiHint}
        </Text>
        {enabled ? (
          <View className="gap-2">
            <Text className="font-display-medium text-sm">{s.modeTitle}</Text>
            <View className="flex-row flex-wrap gap-2">
              {VOICE_MODES.map((m) => (
                <Chip
                  key={m}
                  label={s.modes[m]}
                  selected={listening === m}
                  onPress={() => {
                    setVoiceMode(m);
                    setListening(m);
                  }}
                />
              ))}
            </View>
            <Text variant="muted" className="text-xs">
              {s.modeHint[listening]}
            </Text>
            {listening !== 'tap' && mode !== null && mode !== 'on_device' ? (
              <Text className="text-xs text-highlight">{s.needsPack}</Text>
            ) : null}
          </View>
        ) : null}
        {mode ? (
          <Text variant="muted" className="text-xs">
            {s.mode[mode]}
          </Text>
        ) : null}
        {mode === 'system' && download !== 'started' ? (
          <Button
            variant="outline"
            label={s.download}
            onPress={() => {
              void downloadPolishModel().then((ok) => setDownload(ok ? 'started' : 'failed'));
            }}
          />
        ) : null}
        {download ? (
          <Text variant="muted" className="text-xs">
            {download === 'started' ? s.downloadStarted : s.downloadFailed}
          </Text>
        ) : null}
      </CardContent>
    </Card>
  );
}

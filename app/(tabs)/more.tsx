import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Card, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { GlossaryModal } from '@/features/glossary/GlossaryModal';
import { pl } from '@/strings/pl';

const items = [
  { href: '/exercises', label: pl.more.exercises },
  { href: '/bands', label: pl.more.bands },
  { href: '/backup', label: pl.more.backup },
  { href: '/settings', label: pl.more.settings },
] as const;

export default function MoreScreen() {
  const [showGlossary, setShowGlossary] = useState(false);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4">
      {items.map((item) => (
        <Link key={item.href} href={item.href} asChild>
          <Card className="active:opacity-70">
            <CardTitle>{item.label}</CardTitle>
          </Card>
        </Link>
      ))}
      <Pressable onPress={() => setShowGlossary(true)}>
        <Card className="active:opacity-70">
          <CardTitle>{pl.more.glossary}</CardTitle>
        </Card>
      </Pressable>
      <View className="pt-4">
        <Text variant="muted">{pl.more.comingSoon}</Text>
      </View>
      <GlossaryModal visible={showGlossary} onClose={() => setShowGlossary(false)} />
    </ScrollView>
  );
}

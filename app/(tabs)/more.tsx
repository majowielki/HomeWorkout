import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { BookOpen, Dumbbell, HardDrive, Layers, Settings, Sparkles } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { GlossaryModal } from '@/features/glossary/GlossaryModal';
import { pl } from '@/strings/pl';

const library = [
  { href: '/exercises', label: pl.more.exercises, hint: pl.more.exercisesHint, icon: Dumbbell },
  { href: '/bands', label: pl.more.bands, hint: pl.more.bandsHint, icon: Layers },
] as const;

const app = [
  { href: '/coach', label: pl.more.coach, hint: pl.more.coachHint, icon: Sparkles },
  { href: '/backup', label: pl.more.backup, hint: pl.more.backupHint, icon: HardDrive },
  { href: '/settings', label: pl.more.settings, hint: pl.more.settingsHint, icon: Settings },
] as const;

export default function MoreScreen() {
  const [showGlossary, setShowGlossary] = useState(false);

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-5 pb-12">
        <PageHeader title={pl.more.title} />

        <Text variant="eyebrow" className="mt-2">
          {pl.more.libraryEyebrow}
        </Text>
        <Card className="py-1">
          {library.map((item, i) => (
            <Link key={item.href} href={item.href} asChild>
              <ListRow icon={item.icon} title={item.label} subtitle={item.hint} divider={i > 0} />
            </Link>
          ))}
          <ListRow
            icon={BookOpen}
            title={pl.more.glossary}
            subtitle={pl.more.glossaryHint}
            onPress={() => setShowGlossary(true)}
            divider
          />
        </Card>

        <Text variant="eyebrow" className="mt-4">
          {pl.more.appEyebrow}
        </Text>
        <Card className="py-1">
          {app.map((item, i) => (
            <Link key={item.href} href={item.href} asChild>
              <ListRow icon={item.icon} title={item.label} subtitle={item.hint} divider={i > 0} />
            </Link>
          ))}
        </Card>

        <Text variant="muted" className="mt-4 text-center text-xs">
          {pl.more.comingSoon}
        </Text>
        <GlossaryModal visible={showGlossary} onClose={() => setShowGlossary(false)} />
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

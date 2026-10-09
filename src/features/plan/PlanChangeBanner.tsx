import { Pressable, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { RefreshCw, X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { PlanBanner } from '@/db/repositories/weekPlan';
import type { SlotRegion } from '@/domain/plan/types';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

import { dayTitle } from './format';

type Props = {
  banner: PlanBanner;
  onClose: (id: string) => void;
  expanded?: boolean;
};

/**
 * What the last replanning of the week changed and why — shown until it is
 * closed, so an automatic correction never happens silently.
 */
export function PlanChangeBanner({ banner, onClose, expanded = false }: Props) {
  const t = pl.plan.banner;
  const title = (regions: readonly SlotRegion[] | null) =>
    regions === null ? t.rest : dayTitle(regions);
  return (
    <Card className="gap-3 border-primary p-5">
      <View className="flex-row items-start gap-3">
        <RefreshCw size={18} className="mt-0.5 text-highlight" />
        <View className="flex-1 gap-1">
          <Text className="font-display-semibold text-base">{t.title}</Text>
          <Text variant="muted" className="text-sm">
            {t.trigger[banner.trigger]}
          </Text>
        </View>
        <Pressable
          onPress={() => onClose(banner.id)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.close}
        >
          <X size={20} className="text-muted-foreground" />
        </Pressable>
      </View>
      {(expanded ? banner.changes : banner.changes.slice(0, 4)).map((c) => (
        <Text key={c.date} className="text-sm">
          {t.change(formatDate(c.date), title(c.before), title(c.after))}
        </Text>
      ))}
    </Card>
  );
}

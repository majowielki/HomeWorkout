import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from '@/components/ui/icons';
import { pl } from '@/strings/pl';

/**
 * Weekly weight trend as a pill. Down is the goal of the programme (deficit
 * on GLP-1/GIP), so it gets the accent; up stays neutral rather than red —
 * a week of water weight is not a failure worth alarming about.
 */
export function WeightTrendBadge({ kgPerWeek }: { kgPerWeek: number }) {
  const Icon = kgPerWeek < 0 ? ArrowDownRight : kgPerWeek > 0 ? ArrowUpRight : ArrowRight;
  const down = kgPerWeek < 0;
  return (
    <Badge
      variant={down ? 'accent' : 'default'}
      label={pl.today.trendValue(kgPerWeek)}
      icon={
        <Icon
          size={14}
          className={down ? 'text-primary-foreground' : 'text-secondary-foreground'}
        />
      }
    />
  );
}

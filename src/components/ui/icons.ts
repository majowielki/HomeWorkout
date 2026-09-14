import {
  Bike,
  CalendarCheck,
  Check,
  Dumbbell,
  Ellipsis,
  History,
  List,
  Minus,
  PersonStanding,
  Plus,
} from 'lucide-react-native';

import { iconWithClassName } from '@/lib/interop';

/**
 * Every lucide icon the app uses, registered once so `className` drives
 * its colour. Import icons from here, never from lucide-react-native
 * directly — an unregistered icon needs a hardcoded `color`, which is
 * wrong in one of the two themes.
 */
const icons = {
  Bike,
  CalendarCheck,
  Check,
  Dumbbell,
  Ellipsis,
  History,
  List,
  Minus,
  PersonStanding,
  Plus,
};

for (const icon of Object.values(icons)) iconWithClassName(icon);

export {
  Bike,
  CalendarCheck,
  Check,
  Dumbbell,
  Ellipsis,
  History,
  List,
  Minus,
  PersonStanding,
  Plus,
};

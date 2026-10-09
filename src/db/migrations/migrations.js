// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_motionless_overlord.sql';
import m0001 from './0001_red_colossus.sql';
import m0002 from './0002_open_punisher.sql';
import m0003 from './0003_tiny_mephisto.sql';
import m0004 from './0004_m7_plan_blocks.sql';
import m0005 from './0005_sides.sql';
import m0006 from './0006_week_plan.sql';
import m0007 from './0007_extra_sessions.sql';
import m0008 from './0008_compose_day.sql';
import m0009 from './0009_set_shortfall.sql';
import m0010 from './0010_engine_v2_storage.sql';
import m0011 from './0011_engine_v2_week.sql';
import m0012 from './0012_engine_v2_answers.sql';
import m0013 from './0013_engine_v2_week_summary.sql';

import m0014 from './0014_activate_engine.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009,
m0010,
m0011,
m0012,
m0013,
m0014
    }
  }
  
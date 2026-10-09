/* global __dirname */
/* Real SQLite plus the production Expo Drizzle driver. Only the native
 * boundary is adapted; query execution and transaction behaviour are real.
 * Run in a Node child because Jest's RN environment has no native SQLite.
 *
 * Every case gets a fresh in-memory database (migrated and, unless it says
 * otherwise, seeded), so a failure names one behaviour and never depends on
 * what an earlier case left behind. The script prints one RESULT line per
 * case; storage.test.ts turns each into its own Jest test. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'src/db/migrations');
const MIGRATIONS = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** The database the repositories see; replaced for every case. */
const current = { native: null, db: null };

function driverFor(native) {
  return {
    prepareSync(sql) {
      const statement = native.prepare(sql);
      return {
        executeSync(params) {
          const result = statement.run(...params);
          return {
            ...result,
            getAllSync: () => statement.all(...params),
            getFirstSync: () => statement.get(...params),
          };
        },
        executeForRawResultSync(params) {
          return { getAllSync: () => statement.all(...params).map((r) => Object.values(r)) };
        },
      };
    },
  };
}

const schema = require('../schema.ts');
const { drizzle } = require('drizzle-orm/expo-sqlite/driver');

/** Migrates a new in-memory database; `beforeEach(file)` runs just before a migration file. */
function openDatabase({ beforeMigration } = {}) {
  current.native?.close();
  const native = new DatabaseSync(':memory:');
  for (const file of MIGRATIONS) {
    beforeMigration?.(file, native);
    native.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  native.exec('PRAGMA foreign_keys = ON');
  current.native = native;
  current.db = drizzle(driverFor(native), { schema });
  return native;
}

const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'expo-crypto') return { randomUUID };
  if (
    (request === '../client' || request === './client') &&
    parent.filename.startsWith(path.join(root, 'src/db'))
  )
    // Read at every use, so each case's fresh database is the one written to.
    return {
      get db() {
        return current.db;
      },
      get sqlite() {
        return current.native;
      },
    };
  return originalLoad.call(this, request, parent, ...rest);
};
const seed = require('../seed.ts');

const all = (sql, ...params) => current.native.prepare(sql).all(...params);
const exec = (sql) => current.native.exec(sql);
/** Makes the next insert into `table` (matching `when`) fail inside SQLite. */
function failInsert(name, table, when = '') {
  exec(
    `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} ${when} BEGIN SELECT RAISE(ABORT, '${name}'); END`,
  );
  return () => exec(`DROP TRIGGER ${name}`);
}

async function seeded() {
  openDatabase();
  await seed.seedDatabase();
}

function firstExerciseId() {
  return all('SELECT id FROM exercises ORDER BY id')[0].id;
}

module.exports = {
  assert,
  root,
  path,
  current,
  schema,
  openDatabase,
  seed,
  all,
  exec,
  failInsert,
  seeded,
  firstExerciseId,
};

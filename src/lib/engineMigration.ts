import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  type ArchiveSink,
  type EngineMigrationResult,
  migrateToEngineV2,
} from '@/db/repositories/engineMigration';

/**
 * The move to engine v2 clears the training data (D21), after writing it all
 * to a file. The machinery is finished and tested, but it is **not run** until
 * the whole of the new engine is: clearing the history to keep running the
 * old engine would only throw it away. Switching it on is a decision taken at
 * activation (P6), together with the screen that tells the person where the
 * archive is.
 */
export const ENGINE_V2_RESET_ENABLED = false;

const ARCHIVE_DIR = 'archive';

/** Files in the app's own document directory, which survives updates and is not the cache. */
export function documentArchive(): ArchiveSink {
  return {
    async write(text, fileName) {
      const dir = new Directory(Paths.document, ARCHIVE_DIR);
      if (!dir.exists) dir.create();
      const file = new File(dir, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      return file.uri;
    },
    async read(location) {
      return new File(location).text();
    },
  };
}

export async function runEngineMigration(
  now: Date = new Date(),
  enabled: boolean = ENGINE_V2_RESET_ENABLED,
  sink: ArchiveSink = documentArchive(),
): Promise<EngineMigrationResult | { kind: 'disabled' }> {
  if (!enabled) return { kind: 'disabled' };
  return migrateToEngineV2(sink, now);
}

/** Hands the archive to the share sheet, so the person can keep a copy elsewhere. */
export async function shareArchive(location: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(location, { mimeType: 'application/json' });
  return true;
}

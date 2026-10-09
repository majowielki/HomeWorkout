import * as Sharing from 'expo-sharing';

import { migrateToEngineV2 } from '@/db/repositories/engineMigration';

import {
  documentArchive,
  ENGINE_V2_RESET_ENABLED,
  runEngineMigration,
  shareArchive,
} from '../engineMigration';

const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${root}/${name}` : root;
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${root}/${name}` : root;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    write(text: string) {
      mockFiles.set(this.uri, text);
    }
    async text() {
      return mockFiles.get(this.uri) ?? '';
    }
  }
  return { Directory, File, Paths: { document: 'file:///doc' } };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('@/db/repositories/engineMigration', () => ({
  migrateToEngineV2: jest.fn(async () => ({ kind: 'already_migrated' })),
}));

describe('the move to engine v2, as the app runs it', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    jest.mocked(migrateToEngineV2).mockClear();
  });

  it('is switched off until the new engine is: the training data is not cleared for the old one', async () => {
    expect(ENGINE_V2_RESET_ENABLED).toBe(false);
    expect(await runEngineMigration(new Date())).toEqual({ kind: 'disabled' });
    expect(migrateToEngineV2).not.toHaveBeenCalled();
  });

  it('runs the migration against the document archive when it is switched on', async () => {
    const result = await runEngineMigration(new Date('2026-10-09T10:00:00Z'), true);
    expect(result).toEqual({ kind: 'already_migrated' });
    expect(migrateToEngineV2).toHaveBeenCalledTimes(1);
  });

  it('writes an archive into the app’s document directory, replaces one of the same name, and reads it back', async () => {
    const sink = documentArchive();
    const location = await sink.write('first', 'a.json');
    expect(location).toBe('file:///doc/archive/a.json');
    expect(await sink.read(location)).toBe('first');
    await sink.write('second', 'a.json');
    expect(await sink.read(location)).toBe('second');
    expect(mockDirs.has('file:///doc/archive')).toBe(true);
    // The directory already exists the second time.
    await sink.write('third', 'b.json');
    expect(mockFiles.size).toBe(2);
  });

  it('offers the archive to the share sheet when sharing exists', async () => {
    expect(await shareArchive('file:///doc/archive/a.json')).toBe(true);
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///doc/archive/a.json', {
      mimeType: 'application/json',
    });
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    expect(await shareArchive('x')).toBe(false);
  });
});

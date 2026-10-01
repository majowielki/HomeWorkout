import Storage from 'expo-sqlite/kv-store';

const KEY = 'ai.enabled';

/**
 * The AI switch (AI-INTEGRACJA I8). Off by default, kept in the key-value
 * store that ships with expo-sqlite: it is a preference, not a record, so it
 * stays out of the schema, the migrations and the backup file.
 *
 * A storage failure reads as "off". The safe answer to "may I send data?"
 * when unsure is no.
 */
export function getAiEnabled(): boolean {
  try {
    return Storage.getItemSync(KEY) === '1';
  } catch {
    return false;
  }
}

export function setAiEnabled(enabled: boolean): void {
  try {
    Storage.setItemSync(KEY, enabled ? '1' : '0');
  } catch (error) {
    console.warn('could not save the AI switch', error);
  }
}

import Storage from 'expo-sqlite/kv-store';

const KEY = 'voice.enabled';

/**
 * The microphone on the session screen. On unless switched off: the person
 * asked for it, nothing is sent anywhere by the switch itself, and the
 * phone asks for the microphone permission on the first tap. Kept in the
 * key-value store like the AI switch: a preference, not a record.
 */
export function getVoiceEnabled(): boolean {
  try {
    return Storage.getItemSync(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setVoiceEnabled(enabled: boolean): void {
  try {
    Storage.setItemSync(KEY, enabled ? '1' : '0');
  } catch (error) {
    console.warn('could not save the voice switch', error);
  }
}

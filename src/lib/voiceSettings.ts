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

const MODE_KEY = 'voice.mode';

/**
 * How the microphone listens during a session: a tap for each command, the
 * microphone left on waiting for "hej trener", or left on for any command.
 * The last two are only used with on-device recognition (GLOS.md §5).
 */
export const VOICE_MODES = ['tap', 'wake', 'continuous'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export function getVoiceMode(): VoiceMode {
  try {
    const stored = Storage.getItemSync(MODE_KEY);
    return VOICE_MODES.find((m) => m === stored) ?? 'tap';
  } catch {
    return 'tap';
  }
}

export function setVoiceMode(mode: VoiceMode): void {
  try {
    Storage.setItemSync(MODE_KEY, mode);
  } catch (error) {
    console.warn('could not save the voice mode', error);
  }
}

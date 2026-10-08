import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/** Commands are Polish. */
export const VOICE_LOCALE = 'pl-PL';

/** Google's on-device speech service, the one that lists installed offline languages. */
const ON_DEVICE_SERVICE = 'com.google.android.as';

/**
 * How speech becomes text on this phone. `on_device` keeps the audio on the
 * phone; `system` is the phone's default speech service, which without an
 * offline language pack may send the recording to its provider.
 */
export type RecognitionMode = 'on_device' | 'system' | 'unavailable';

const hasPolish = (locales: readonly string[]) =>
  locales.some((l) => l.toLowerCase().startsWith('pl'));

/** On the phone when it can be, the system service otherwise. */
export async function recognitionMode(): Promise<RecognitionMode> {
  try {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'unavailable';
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return 'system';
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({
      androidRecognitionServicePackage: ON_DEVICE_SERVICE,
    });
    return hasPolish(installedLocales) ? 'on_device' : 'system';
  } catch {
    // No on-device service, or it would not say: the system one is still there.
    return 'system';
  }
}

/** Asks the phone to download the Polish offline model; Android shows its own dialog or queues it. */
export async function downloadPolishModel(): Promise<boolean> {
  try {
    await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: VOICE_LOCALE });
    return true;
  } catch {
    return false;
  }
}

export async function requestMicrophone(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * One utterance: listening stops by itself after the phrase. A few
 * alternatives come back, because the vocabulary may know the second
 * guess when it does not know the first.
 */
export function startListening(mode: RecognitionMode, phrases: readonly string[]): void {
  ExpoSpeechRecognitionModule.start({
    lang: VOICE_LOCALE,
    interimResults: true,
    maxAlternatives: 5,
    continuous: false,
    requiresOnDeviceRecognition: mode === 'on_device',
    addsPunctuation: false,
    contextualStrings: [...phrases],
  });
}

export function stopListening(): void {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {
    // Nothing was listening.
  }
}

/** Stops listening and lets the recogniser report what it heard so far. */
export function finishListening(): void {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {
    // Nothing was listening.
  }
}

import Storage from 'expo-sqlite/kv-store';

const KEY = 'warmup.view';

/** How the warm-up is shown: the checklist, or one big card per move. */
export type WarmupView = 'list' | 'cards';

/**
 * The last chosen warm-up view. A preference, not a record — like the AI
 * switch it lives in expo-sqlite's key-value store, outside the backup.
 * A storage failure reads as the default list.
 */
export function getWarmupView(): WarmupView {
  try {
    return Storage.getItemSync(KEY) === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

export function setWarmupView(view: WarmupView): void {
  try {
    Storage.setItemSync(KEY, view);
  } catch (error) {
    console.warn('could not save the warm-up view', error);
  }
}

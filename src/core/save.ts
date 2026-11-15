// Versioned localStorage save. A corrupt or unreadable save never throws:
// load() reports it and the UI offers a reset.
import { newState, defaultSettings, SAVE_VERSION, type GameState } from './logic';

export const SAVE_KEY = 'cartographer.save';

type Raw = Record<string, unknown>;

/** migrations[n] upgrades a save from version n to n+1. */
const migrations: Record<number, (raw: Raw) => Raw> = {
  // v0 was the pre-release shape: no items, no captions setting, no key map.
  0: (raw) => {
    const d = defaultSettings();
    const settings = { ...d, ...((raw.settings as Raw) ?? {}) } as Raw;
    settings.keys = { ...d.keys, ...((settings.keys as Raw) ?? {}) };
    return { ...raw, items: raw.items ?? { locket: false, compass: false }, settings, v: 1 };
  },
};

export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  let data = raw as Raw;
  let v = typeof data.v === 'number' ? data.v : 0;
  if (v > SAVE_VERSION) return null;
  while (v < SAVE_VERSION) {
    const step = migrations[v];
    if (!step) return null;
    data = step(data);
    v += 1;
  }
  // Fill anything missing from a fresh state so partial saves stay playable.
  const base = newState();
  const merged = { ...base, ...data } as GameState;
  merged.settings = { ...base.settings, ...merged.settings, keys: { ...base.settings.keys, ...merged.settings?.keys } };
  merged.zones = { ...base.zones, ...merged.zones };
  merged.items = { ...base.items, ...merged.items };
  const ok =
    Array.isArray(merged.dps) &&
    Array.isArray(merged.read) &&
    Array.isArray(merged.achievements) &&
    Array.isArray(merged.symbols) &&
    Array.isArray(merged.stakes) &&
    merged.stakes.length === base.stakes.length &&
    Array.isArray(merged.dials) &&
    merged.dials.length === 2 &&
    typeof merged.gates === 'object' &&
    merged.gates !== null;
  return ok ? merged : null;
}

export interface LoadResult {
  state: GameState;
  status: 'new' | 'loaded' | 'corrupt';
}

export function load(storage: Pick<Storage, 'getItem'> | null): LoadResult {
  let text: string | null = null;
  try {
    text = storage?.getItem(SAVE_KEY) ?? null;
  } catch {
    return { state: newState(), status: 'new' };
  }
  if (text === null) return { state: newState(), status: 'new' };
  try {
    const state = migrate(JSON.parse(text));
    if (state) return { state, status: 'loaded' };
  } catch {
    /* fall through */
  }
  return { state: newState(), status: 'corrupt' };
}

export function save(storage: Pick<Storage, 'setItem'> | null, state: GameState): boolean {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // private mode / quota: play on without saving
  }
}

export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

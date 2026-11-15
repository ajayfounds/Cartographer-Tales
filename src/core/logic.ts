// Pure game rules. Nothing in here touches the DOM, three.js or storage, so
// every puzzle, the exploration rule and the achievement rules are unit-tested
// without rendering (see logic.test.ts).
import { DISCOVERY_POINTS, STAKES, HOLDS, ZONE_IDS, type ZoneId } from '../world/layout';

export type Glyph = 'ring' | 'wave' | 'bars' | 'eye' | 'fork' | 'star';
export const GLYPHS: Glyph[] = ['ring', 'wave', 'bars', 'eye', 'fork', 'star'];
export const GLYPH_NAMES: Record<Glyph, string> = {
  ring: 'open ring',
  wave: 'three waves',
  bars: 'three bars',
  eye: 'eye',
  fork: 'dividers',
  star: 'four-point star',
};
export const CLIMB_ROUTE: Glyph[] = ['ring', 'bars', 'ring', 'star'];
export const VAULT_ANSWER: [Glyph, Glyph] = ['wave', 'fork'];

export type Side = 'L' | 'R';
export type Quality = 'auto' | 'high' | 'low';
export type Action = 'forward' | 'back' | 'left' | 'right' | 'run' | 'interact' | 'map';

export interface Settings {
  volume: number;
  sensitivity: number;
  invertY: boolean;
  quality: Quality;
  reducedMotion: boolean;
  captions: boolean;
  keys: Record<Action, string>;
}

export const SAVE_VERSION = 1;

export interface GameState {
  v: number;
  started: boolean;
  zones: Record<ZoneId, { visited: boolean; complete: boolean }>;
  dps: string[];
  read: string[];
  stakes: { found: boolean; dir: number }[];
  gates: { A: Side; B: Side; C: Side };
  chime: number;
  dials: [number, number];
  vaultOpen: boolean;
  items: { locket: boolean; compass: boolean };
  symbols: Glyph[];
  achievements: string[];
  ended: boolean;
  pos: { x: number; y: number; z: number; yaw: number } | null;
  playTime: number;
  settings: Settings;
}

export function defaultSettings(): Settings {
  return {
    volume: 0.8,
    sensitivity: 1,
    invertY: false,
    quality: 'auto',
    reducedMotion: false,
    captions: true,
    keys: {
      forward: 'KeyW',
      back: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      interact: 'KeyE',
      map: 'KeyM',
    },
  };
}

export function newState(): GameState {
  return {
    v: SAVE_VERSION,
    started: false,
    zones: {
      1: { visited: false, complete: false },
      2: { visited: false, complete: false },
      3: { visited: false, complete: false },
      4: { visited: false, complete: false },
      5: { visited: false, complete: false },
    },
    dps: [],
    read: [],
    stakes: STAKES.map((s) => ({ found: false, dir: s.initial })),
    gates: { A: 'L', B: 'L', C: 'L' },
    chime: 0,
    dials: [0, 0],
    vaultOpen: false,
    items: { locket: false, compass: false },
    symbols: [],
    achievements: [],
    ended: false,
    pos: null,
    playTime: 0,
    settings: defaultSettings(),
  };
}

// ---- Zone 1: stakes ---------------------------------------------------------
// States per stake: fallen -> upright(dir 0..7). Input: interact.
// fallen + interact = upright (direction unchanged); upright + interact = dir+1.
// Win: all three upright and dir == target. After the win, stakes are locked.
export function stakeAligned(s: GameState, i: number): boolean {
  return s.stakes[i].found && s.stakes[i].dir === STAKES[i].target;
}
export function stakesSolved(s: GameState): boolean {
  return s.stakes.every((_, i) => stakeAligned(s, i));
}
export function stakeInteract(s: GameState, i: number): 'righted' | 'turned' | 'locked' {
  if (s.zones[1].complete) return 'locked';
  const st = s.stakes[i];
  if (!st.found) {
    st.found = true;
    return 'righted';
  }
  st.dir = (st.dir + 1) % 8;
  return 'turned';
}

// ---- Zone 2: sluice gates ---------------------------------------------------
// One stream, three two-way wheels.
//   spring -> A.  A:L -> pool 1 (the hidden terrace).  A:R -> B.
//   B:L -> pool 2 (the long basin you must cross to reach C).  B:R -> C.
//   C:L -> pool 1 again.  C:R -> the outfall.
// Unfed pools drain by themselves. Win: water reaches the outfall (A,B,C = R),
// which leaves pool 1 dry. There is no failure state; any wheel can be turned back.
export interface Flow {
  pool1: boolean;
  pool2: boolean;
  outfall: boolean;
  segments: string[];
}
export function gateFlow(g: GameState['gates']): Flow {
  const segments = ['spring'];
  let pool1 = false;
  let pool2 = false;
  let outfall = false;
  if (g.A === 'L') {
    segments.push('A_L');
    pool1 = true;
  } else {
    segments.push('A_R');
    if (g.B === 'L') {
      segments.push('B_L');
      pool2 = true;
    } else {
      segments.push('B_R');
      if (g.C === 'L') {
        segments.push('C_L');
        pool1 = true;
      } else {
        segments.push('C_R');
        outfall = true;
      }
    }
  }
  return { pool1, pool2, outfall, segments };
}
export function gatesSolved(g: GameState['gates']): boolean {
  return gateFlow(g).outfall;
}
export function gateTurn(s: GameState, id: 'A' | 'B' | 'C'): Side {
  s.gates[id] = s.gates[id] === 'L' ? 'R' : 'L';
  return s.gates[id];
}

// ---- Zone 3: chimes ---------------------------------------------------------
// state.chime is the index of the one chime that is ringing. Reaching it
// (within CHIME_REACH) hands the sound to the next. The last hangs over the grave.
export function chimeReached(s: GameState, index: number, lastIndex: number): boolean {
  if (index !== s.chime || s.chime >= lastIndex) return false;
  s.chime += 1;
  return true;
}

// ---- Zone 4: holds ----------------------------------------------------------
export function holdBears(tier: number, holdIndex: number): boolean {
  return HOLDS[tier][holdIndex].glyph === CLIMB_ROUTE[tier];
}

// ---- Zone 5: the Vault ------------------------------------------------------
export function vaultUnlocked(s: GameState): boolean {
  return s.zones[1].complete && s.zones[2].complete && s.zones[3].complete && s.zones[4].complete;
}
export function dialsSolved(d: [number, number]): boolean {
  return GLYPHS[d[0]] === VAULT_ANSWER[0] && GLYPHS[d[1]] === VAULT_ANSWER[1];
}
export function dialTurn(s: GameState, i: 0 | 1): boolean {
  if (s.vaultOpen) return false;
  s.dials[i] = (s.dials[i] + 1) % GLYPHS.length;
  if (dialsSolved(s.dials)) s.vaultOpen = true;
  return s.vaultOpen;
}

// ---- Discovery and the "explored" rule -------------------------------------
// "Explored" counts every discovery point plus every zone's completion.
// 100% = all 19 discovery points found AND all 5 zones complete.
export function discover(s: GameState, id: string): boolean {
  if (s.dps.includes(id)) return false;
  s.dps.push(id);
  return true;
}
export function exploredFraction(s: GameState): number {
  const done = s.dps.length + ZONE_IDS.filter((z) => s.zones[z].complete).length;
  return done / (DISCOVERY_POINTS.length + ZONE_IDS.length);
}
/** 0 = blank, up to 0.6 from discovery points alone, 1 once the zone is complete. */
export function zoneReveal(s: GameState, zone: ZoneId): number {
  if (s.zones[zone].complete) return 1;
  const pts = DISCOVERY_POINTS.filter((d) => d.zone === zone);
  const found = pts.filter((d) => s.dps.includes(d.id)).length;
  const base = s.zones[zone].visited ? 0.2 : 0;
  return Math.min(0.6, base + (0.4 * found) / pts.length);
}

// ---- Achievements -----------------------------------------------------------
export const ACHIEVEMENT_RULES: { id: string; test: (s: GameState) => boolean }[] = [
  { id: 'first_lines', test: (s) => s.zones[1].complete },
  { id: 'drained_charted', test: (s) => s.zones[2].complete },
  { id: 'followed_sound', test: (s) => s.zones[3].complete },
  { id: 'view_above', test: (s) => s.zones[4].complete },
  { id: 'map_complete', test: (s) => s.zones[5].complete },
  { id: 'nothing_uncharted', test: (s) => DISCOVERY_POINTS.every((d) => s.dps.includes(d.id)) },
  { id: 'old_partners', test: (s) => s.items.locket && s.items.compass },
];
/** Unlocks anything newly earned and returns the new ids (each id only ever once). */
export function evaluateAchievements(s: GameState): string[] {
  const fresh: string[] = [];
  for (const rule of ACHIEVEMENT_RULES) {
    if (!s.achievements.includes(rule.id) && rule.test(s)) {
      s.achievements.push(rule.id);
      fresh.push(rule.id);
    }
  }
  return fresh;
}

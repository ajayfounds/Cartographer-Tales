import { describe, it, expect } from 'vitest';
import {
  newState, stakeInteract, stakesSolved, gateFlow, gatesSolved, gateTurn, chimeReached, holdBears,
  vaultUnlocked, dialTurn, dialsSolved, GLYPHS, VAULT_ANSWER, discover, exploredFraction, zoneReveal,
  evaluateAchievements, CLIMB_ROUTE, SAVE_VERSION,
} from './logic';
import { migrate, load, save, SAVE_KEY } from './save';
import { DISCOVERY_POINTS, STAKES, HOLDS, CHIMES, CAIRN, ZONES, zoneAt } from '../world/layout';

describe('zone 1 stakes', () => {
  it('each stake target really points at the cairn', () => {
    for (const st of STAKES) {
      const a = Math.atan2(CAIRN.x - st.x, -(CAIRN.z - st.z)); // 0 = north, clockwise
      const eighth = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      expect(eighth).toBe(st.target);
    }
  });
  it('first interact rights a stake, later ones turn it, solved when all on target', () => {
    const s = newState();
    expect(stakesSolved(s)).toBe(false);
    STAKES.forEach((st, i) => {
      expect(stakeInteract(s, i)).toBe('righted');
      let guard = 0;
      while (s.stakes[i].dir !== st.target && guard++ < 8) expect(stakeInteract(s, i)).toBe('turned');
    });
    expect(stakesSolved(s)).toBe(true);
    s.zones[1].complete = true;
    expect(stakeInteract(s, 0)).toBe('locked');
  });
  it('is not solved at the start, even if all stakes are righted', () => {
    const s = newState();
    STAKES.forEach((_, i) => stakeInteract(s, i));
    expect(stakesSolved(s)).toBe(false);
  });
});

describe('zone 2 gates', () => {
  it('starts with pool 1 flooded and the long basin dry', () => {
    const f = gateFlow(newState().gates);
    expect(f).toMatchObject({ pool1: true, pool2: false, outfall: false });
  });
  it('turning A first floods the long basin (cutting off wheel C)', () => {
    const s = newState();
    gateTurn(s, 'A');
    expect(gateFlow(s.gates)).toMatchObject({ pool1: false, pool2: true, outfall: false });
  });
  it('A,B right with C left still feeds pool 1', () => {
    const f = gateFlow({ A: 'R', B: 'R', C: 'L' });
    expect(f).toMatchObject({ pool1: true, pool2: false, outfall: false });
  });
  it('only all-right reaches the outfall', () => {
    let wins = 0;
    for (const A of ['L', 'R'] as const) for (const B of ['L', 'R'] as const) for (const C of ['L', 'R'] as const) {
      if (gatesSolved({ A, B, C })) { wins++; expect([A, B, C]).toEqual(['R', 'R', 'R']); }
    }
    expect(wins).toBe(1);
  });
  it('intended order C, B, A never floods the basin while crossing', () => {
    const s = newState();
    gateTurn(s, 'C'); expect(gateFlow(s.gates).pool2).toBe(false);
    gateTurn(s, 'B'); expect(gateFlow(s.gates).pool2).toBe(false);
    gateTurn(s, 'A'); expect(gatesSolved(s.gates)).toBe(true);
  });
});

describe('zone 3 chimes', () => {
  it('only the ringing chime advances, and the last one never does', () => {
    const s = newState();
    const last = CHIMES.length - 1;
    expect(chimeReached(s, 2, last)).toBe(false);
    for (let i = 0; i < last; i++) expect(chimeReached(s, i, last)).toBe(true);
    expect(s.chime).toBe(last);
    expect(chimeReached(s, last, last)).toBe(false);
  });
});

describe('zone 4 holds', () => {
  it('every tier has exactly one hold that bears weight, matching the route', () => {
    HOLDS.forEach((tier, t) => {
      const good = tier.filter((_, i) => holdBears(t, i));
      expect(good.length).toBe(1);
      expect(good[0].glyph).toBe(CLIMB_ROUTE[t]);
    });
  });
});

describe('zone 5 vault', () => {
  it('stays locked until zones 1-4 are complete', () => {
    const s = newState();
    expect(vaultUnlocked(s)).toBe(false);
    for (const z of [1, 2, 3] as const) s.zones[z].complete = true;
    expect(vaultUnlocked(s)).toBe(false);
    s.zones[4].complete = true;
    expect(vaultUnlocked(s)).toBe(true);
  });
  it('opens only on wave + dividers and then locks the dials', () => {
    const s = newState();
    expect(dialsSolved(s.dials)).toBe(false);
    const want = [GLYPHS.indexOf(VAULT_ANSWER[0]), GLYPHS.indexOf(VAULT_ANSWER[1])];
    while (s.dials[0] !== want[0]) expect(dialTurn(s, 0)).toBe(false);
    let opened = false;
    while (s.dials[1] !== want[1]) opened = dialTurn(s, 1);
    expect(opened).toBe(true);
    expect(s.vaultOpen).toBe(true);
    const before = [...s.dials];
    dialTurn(s, 0);
    expect(s.dials).toEqual(before);
  });
});

describe('discovery and explored rule', () => {
  it('discovery points sit inside their zone and ids are unique', () => {
    expect(new Set(DISCOVERY_POINTS.map((d) => d.id)).size).toBe(DISCOVERY_POINTS.length);
    for (const d of DISCOVERY_POINTS) {
      const zn = ZONES[d.zone];
      expect(Math.hypot(d.x - zn.cx, d.z - zn.cz)).toBeLessThanOrEqual(zn.r + 5);
    }
    expect(zoneAt(0, 128)).toBe(1);
    expect(zoneAt(60, 60)).toBe(0);
  });
  it('100% needs every point and every zone', () => {
    const s = newState();
    expect(exploredFraction(s)).toBe(0);
    for (const d of DISCOVERY_POINTS) expect(discover(s, d.id)).toBe(true);
    expect(discover(s, DISCOVERY_POINTS[0].id)).toBe(false);
    expect(exploredFraction(s)).toBeLessThan(1);
    for (const z of [1, 2, 3, 4, 5] as const) s.zones[z].complete = true;
    expect(exploredFraction(s)).toBe(1);
  });
  it('a zone is only fully inked once complete', () => {
    const s = newState();
    expect(zoneReveal(s, 2)).toBe(0);
    s.zones[2].visited = true;
    for (const d of DISCOVERY_POINTS.filter((d) => d.zone === 2)) discover(s, d.id);
    expect(zoneReveal(s, 2)).toBeCloseTo(0.6);
    s.zones[2].complete = true;
    expect(zoneReveal(s, 2)).toBe(1);
  });
});

describe('achievements', () => {
  it('each zone achievement unlocks from its zone, exactly once', () => {
    const s = newState();
    expect(evaluateAchievements(s)).toEqual([]);
    const ids = ['first_lines', 'drained_charted', 'followed_sound', 'view_above', 'map_complete'];
    ([1, 2, 3, 4, 5] as const).forEach((z, i) => {
      s.zones[z].complete = true;
      expect(evaluateAchievements(s)).toEqual([ids[i]]);
      expect(evaluateAchievements(s)).toEqual([]);
    });
  });
  it('hidden achievements follow their rules', () => {
    const s = newState();
    s.items.locket = true;
    expect(evaluateAchievements(s)).toEqual([]);
    s.items.compass = true;
    expect(evaluateAchievements(s)).toEqual(['old_partners']);
    for (const d of DISCOVERY_POINTS.slice(1)) discover(s, d.id);
    expect(evaluateAchievements(s)).toEqual([]);
    discover(s, DISCOVERY_POINTS[0].id);
    expect(evaluateAchievements(s)).toEqual(['nothing_uncharted']);
  });
});

describe('save', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it('round-trips', () => {
    const st = mem();
    const s = newState();
    s.zones[1].complete = true; s.dps.push('DP-Z1-01'); s.settings.invertY = true;
    expect(save(st, s)).toBe(true);
    const r = load(st);
    expect(r.status).toBe('loaded');
    expect(r.state).toEqual(s);
  });
  it('no save gives a new game', () => {
    expect(load(mem()).status).toBe('new');
  });
  it('corrupt saves are reported, never thrown', () => {
    for (const bad of ['{not json', '42', '{"v":1,"dps":"nope"}', '{"v":999}', 'null']) {
      const st = mem(); st.m.set(SAVE_KEY, bad);
      const r = load(st);
      expect(r.status).toBe('corrupt');
      expect(r.state.v).toBe(SAVE_VERSION);
    }
  });
  it('migrates a v0 save without losing progress', () => {
    const v0 = { ...newState(), settings: { volume: 0.3 } } as Record<string, unknown>;
    delete v0.v; delete v0.items;
    (v0.zones as Record<number, { complete: boolean }>)[1].complete = true;
    const s = migrate(JSON.parse(JSON.stringify(v0)))!;
    expect(s.v).toBe(SAVE_VERSION);
    expect(s.zones[1].complete).toBe(true);
    expect(s.items).toEqual({ locket: false, compass: false });
    expect(s.settings.volume).toBe(0.3);
    expect(s.settings.keys.forward).toBe('KeyW');
    expect(s.settings.captions).toBe(true);
  });
  it('a throwing storage does not break saving', () => {
    expect(save({ setItem: () => { throw new Error('quota'); } }, newState())).toBe(false);
  });
});

// Terrain height, colliders and tree placement. Pure maths (no three.js) so the
// character controller and tests can run without a renderer.
import {
  ZONES, WORLD_RADIUS, RING_ROAD_R, POOL1, POOL2, MESA, VAULT, CHIMES, GRAVE, STAKES, CAIRN,
  DISCOVERY_POINTS, GATES, TRAILHEAD_GAP, SPAWN,
} from './layout';

export const TERRAIN_SIZE = 420;
export const TERRAIN_SEG = 280; // 1.5 m cells
const HALF = TERRAIN_SIZE / 2;
const CELL = TERRAIN_SIZE / TERRAIN_SEG;
const N = TERRAIN_SEG + 1;

// ---- deterministic random ---------------------------------------------------
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// ---- roads ------------------------------------------------------------------
export const ROADS: [number, number, number, number][] = [
  [0, 152, 0, 96], // trailhead track
  [0, 96, 0, RING_ROAD_R], // the hidden road
  [0, RING_ROAD_R, 0, VAULT.wallR], // ring to the Vault gate
  [-RING_ROAD_R, 0, -92, 0],
  [RING_ROAD_R, 0, 84, 0],
  [0, -RING_ROAD_R, 0, -92],
];
function distSeg(x: number, z: number, s: [number, number, number, number]): number {
  const dx = s[2] - s[0], dz = s[3] - s[1];
  const t = clamp01(((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz));
  return Math.hypot(x - (s[0] + dx * t), z - (s[1] + dz * t));
}
export function distToRoad(x: number, z: number): number {
  let d = Math.abs(Math.hypot(x, z) - RING_ROAD_R);
  for (const s of ROADS) d = Math.min(d, distSeg(x, z, s));
  return d;
}

const PLAZA = { x0: -173, x1: -90, z0: -50, z1: 46 };
function inRect(x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }, pad = 0) {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

/** Analytic height. Sampled once into a grid; gameplay reads the grid. */
function heightAnalytic(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const dMesa = Math.hypot(x - MESA.cx, z - MESA.cz);
  // how "wild" the ground is here: 0 on built ground, 1 in open country
  let wild = 1;
  wild = Math.min(wild, clamp01((r - 26) / 8)); // vault court
  wild = Math.min(wild, clamp01((dMesa - 32) / 6));
  if (inRect(x, z, PLAZA, 6)) {
    const e = Math.min(x - (PLAZA.x0 - 6), PLAZA.x1 + 6 - x, z - (PLAZA.z0 - 6), PLAZA.z1 + 6 - z);
    wild = Math.min(wild, 1 - clamp01(e / 6));
  }
  wild = Math.min(wild, 0.25 + 0.75 * clamp01((distToRoad(x, z) - 2) / 5));
  let h = (vnoise(x / 23, z / 23) - 0.5) * 2.4 + (vnoise(x / 7 + 40, z / 7) - 0.5) * 0.5;
  h *= wild;

  // outer rim
  if (r > 170) h += Math.min(22, ((r - 170) / 5) ** 2 * 3) + (r > 190 ? vnoise(x / 30, z / 30) * 10 : 0);

  // ridge around the trailhead, open on the north side
  const z1 = ZONES[1];
  const d1 = Math.hypot(x - z1.cx, z - z1.cz);
  const ridge = Math.exp(-(((d1 - 39) / 3.2) ** 2));
  const gap = clamp01((Math.abs(x) - 3.5) / 5); // gap centred on x=0, north side only
  h += 6.5 * ridge * (z < z1.cz ? gap : 1);

  // zone 2 basins
  if (inRect(x, z, POOL1)) {
    h = POOL1.floor * clamp01((POOL1.x1 - x) / POOL1.ramp);
  } else if (inRect(x, z, POOL2)) {
    h = POOL2.floor * Math.min(clamp01((POOL2.x1 - x) / POOL2.ramp), clamp01((x - POOL2.x0) / POOL2.ramp));
  }

  // zone 4 stepped hill
  for (const rad of MESA.radii) if (dMesa < rad) h += MESA.step;
  return h;
}

const grid = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) grid[j * N + i] = heightAnalytic(-HALF + i * CELL, -HALF + j * CELL);
export const heightGrid = grid;

export function heightAt(x: number, z: number): number {
  const gx = Math.min(Math.max((x + HALF) / CELL, 0), TERRAIN_SEG - 0.001);
  const gz = Math.min(Math.max((z + HALF) / CELL, 0), TERRAIN_SEG - 0.001);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const a = grid[iz * N + ix], b = grid[iz * N + ix + 1], c = grid[(iz + 1) * N + ix], d = grid[(iz + 1) * N + ix + 1];
  // match the mesh's triangle split (diagonal from b to c)
  return fx + fz < 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

export type Ground = 'grass' | 'road' | 'stone' | 'basin' | 'rock' | 'needles' | 'court';
export function groundAt(x: number, z: number): Ground {
  if (inRect(x, z, POOL1) || inRect(x, z, POOL2)) return 'basin';
  if (inRect(x, z, PLAZA)) return 'stone';
  if (Math.hypot(x - MESA.cx, z - MESA.cz) < 33) return 'rock';
  const r = Math.hypot(x, z);
  if (r < 27) return 'court';
  if (r > 174) return 'rock';
  if (distToRoad(x, z) < 2.4) return 'road';
  const z3 = ZONES[3];
  if (Math.hypot(x - z3.cx, z - z3.cz) < z3.r) return 'needles';
  return 'grass';
}

// ---- colliders --------------------------------------------------------------
export interface Circle { x: number; z: number; r: number; off?: boolean }
export interface Box { x0: number; x1: number; z0: number; z1: number }
export interface RingWall { cx: number; cz: number; r: number; gapAngle: number; gapWidth: number; open: boolean }

export const boxes: Box[] = [
  { x0: -171, x1: -122, z0: 8, z1: 10 }, // long basin, north wall
  { x0: -171, x1: -122, z0: 30, z1: 32 }, // long basin, south wall
  { x0: -172, x1: -170, z0: 8, z1: 32 }, // west parapet above the outfall
];

export const ringWalls = {
  trailhead: { cx: ZONES[1].cx, cz: ZONES[1].cz, r: 36, gapAngle: TRAILHEAD_GAP.angle, gapWidth: TRAILHEAD_GAP.width, open: false } as RingWall,
  vault: { cx: 0, cz: 0, r: VAULT.wallR, gapAngle: VAULT.gateAngle, gapWidth: VAULT.gateWidth, open: false } as RingWall,
};

/** Solid props that are not trees. `off` lets the world remove one (the Vault seal). */
export const props: Record<string, Circle> = {
  seal: { x: 0, z: 0, r: VAULT.sealR },
  cairn: { x: CAIRN.x, z: CAIRN.z, r: 0.9 },
  grave: { x: GRAVE.x, z: GRAVE.z - 0.5, r: 0.5 },
  tent: { x: -17, z: 128, r: 1.6 },
  statue: { x: -100, z: 22, r: 0.9 },
  gateA: { x: GATES.A.x + 1.4, z: GATES.A.z, r: 0.6 },
  gateB: { x: GATES.B.x + 1.4, z: GATES.B.z, r: 0.6 },
  gateC: { x: GATES.C.x + 1.4, z: GATES.C.z, r: 0.6 },
  dial0: { x: VAULT.dials[0].x, z: VAULT.dials[0].z, r: 0.6 },
  dial1: { x: VAULT.dials[1].x, z: VAULT.dials[1].z, r: 0.6 },
};

// ---- trees ------------------------------------------------------------------
export interface Tree { x: number; z: number; s: number; kind: 'pine' | 'birch' | 'dead'; rot: number }

function clearOfThings(x: number, z: number, pad: number): boolean {
  for (const d of DISCOVERY_POINTS) if (Math.hypot(x - d.x, z - d.z) < pad + 1.5) return false;
  for (const c of CHIMES) if (Math.hypot(x - c.x, z - c.z) < pad + 1) return false;
  for (const s of STAKES) if (Math.hypot(x - s.x, z - s.z) < pad + 1.5) return false;
  if (Math.hypot(x - GRAVE.x, z - GRAVE.z) < 7) return false;
  if (Math.hypot(x - 110, z - 26) < 7.5) return false; // standing stones
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 5) return false;
  return true;
}

function makeTrees(): Tree[] {
  const rand = rng(20261115);
  const out: Tree[] = [];
  const cell = 4;
  const buckets = new Map<number, Tree[]>();
  const key = (x: number, z: number) => Math.floor((x + 300) / cell) * 1000 + Math.floor((z + 300) / cell);
  const tooClose = (x: number, z: number, min: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = buckets.get(key(x + dx * cell, z + dz * cell));
      if (b) for (const t of b) if (Math.hypot(t.x - x, t.z - z) < min) return true;
    }
    return false;
  };
  const add = (t: Tree) => {
    out.push(t);
    const k = key(t.x, t.z);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
  };
  const z1 = ZONES[1], z3 = ZONES[3];

  // the Whisper Pines: dense
  for (let i = 0; i < 2600 && out.length < 520; i++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * (z3.r + 6);
    const x = z3.cx + Math.cos(a) * rr, z = z3.cz + Math.sin(a) * rr;
    if (Math.hypot(x, z) > WORLD_RADIUS - 6 || !clearOfThings(x, z, 1.6) || tooClose(x, z, 2.7)) continue;
    if (x < 86 && Math.abs(z) < 3) continue; // the road in
    add({ x, z, s: 1.1 + rand() * 0.9, kind: 'pine', rot: rand() * 6.28 });
  }
  // open country: sparse, greying
  const pinesEnd = out.length;
  for (let i = 0; i < 6000 && out.length < pinesEnd + 620; i++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * (WORLD_RADIUS - 4);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (rr < 31 || distToRoad(x, z) < 4.5) continue;
    if (inRect(x, z, PLAZA, 3) || inRect(x, z, { x0: -154, x1: -90, z0: -74, z1: -50 })) continue;
    if (Math.hypot(x - MESA.cx, z - MESA.cz) < 35) continue;
    if (Math.hypot(x - z3.cx, z - z3.cz) < z3.r + 6) continue;
    const d1 = Math.hypot(x - z1.cx, z - z1.cz);
    if (d1 < 33 && rand() < 0.8) continue; // keep the trailhead clearing open
    if (d1 > 33 && d1 < 45) continue; // ridge handled below
    if (!clearOfThings(x, z, 2.2) || tooClose(x, z, 3.4)) continue;
    const k = rand();
    add({ x, z, s: 0.9 + rand() * 0.9, kind: k < 0.3 ? 'dead' : k < 0.62 ? 'birch' : 'pine', rot: rand() * 6.28 });
  }
  // the thicket ridge that hides the trailhead
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2 + rand() * 0.02;
    const rr = 37.5 + rand() * 4;
    const x = z1.cx + Math.cos(a) * rr, z = z1.cz + Math.sin(a) * rr;
    if (Math.abs(x) < 5.5 && z < z1.cz) continue; // the gap
    if (Math.abs(x) < 3 && z > z1.cz) continue;
    add({ x, z, s: 1.2 + rand() * 0.8, kind: rand() < 0.7 ? 'pine' : 'dead', rot: rand() * 6.28 });
  }
  return out;
}
export const trees: Tree[] = makeTrees();

// spatial hash for circle collision
const HCELL = 6;
const hash = new Map<number, Circle[]>();
const hkey = (x: number, z: number) => Math.floor((x + 300) / HCELL) * 1000 + Math.floor((z + 300) / HCELL);
function hadd(c: Circle) {
  const k = hkey(c.x, c.z);
  (hash.get(k) ?? hash.set(k, []).get(k)!).push(c);
}
for (const t of trees) hadd({ x: t.x, z: t.z, r: 0.26 * t.s });
for (const p of Object.values(props)) hadd(p);

const TAU = Math.PI * 2;
function inGap(w: RingWall, x: number, z: number, pr: number): boolean {
  if (!w.open) return false;
  let da = Math.atan2(z - w.cz, x - w.cx) - w.gapAngle;
  da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return Math.abs(da) * w.r < w.gapWidth / 2 - pr * 0.5;
}

/**
 * Push a moving circle out of solid things. `prev` is where it was last frame
 * (used so nothing thin can be tunnelled through). Mutates and returns `p`.
 */
export function resolve(p: { x: number; z: number }, prev: { x: number; z: number }, pr: number) {
  // world edge
  const r = Math.hypot(p.x, p.z);
  if (r > WORLD_RADIUS - 2) {
    p.x *= (WORLD_RADIUS - 2) / r;
    p.z *= (WORLD_RADIUS - 2) / r;
  }
  for (const w of Object.values(ringWalls)) {
    const d = Math.hypot(p.x - w.cx, p.z - w.cz) || 1e-6;
    const pd = Math.hypot(prev.x - w.cx, prev.z - w.cz);
    const t = 0.7 + pr;
    const crossed = pd - w.r > 0 !== d - w.r > 0;
    if ((Math.abs(d - w.r) < t || crossed) && !inGap(w, p.x, p.z, pr)) {
      const want = pd >= w.r ? w.r + t : w.r - t;
      p.x = w.cx + ((p.x - w.cx) / d) * want;
      p.z = w.cz + ((p.z - w.cz) / d) * want;
    }
  }
  for (const b of boxes) {
    if (p.x > b.x0 - pr && p.x < b.x1 + pr && p.z > b.z0 - pr && p.z < b.z1 + pr) {
      const l = p.x - (b.x0 - pr), rr = b.x1 + pr - p.x, u = p.z - (b.z0 - pr), dn = b.z1 + pr - p.z;
      const m = Math.min(l, rr, u, dn);
      if (m === l) p.x = b.x0 - pr;
      else if (m === rr) p.x = b.x1 + pr;
      else if (m === u) p.z = b.z0 - pr;
      else p.z = b.z1 + pr;
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const list = hash.get(hkey(p.x + dx * HCELL, p.z + dz * HCELL));
    if (!list) continue;
    for (const c of list) {
      if (c.off) continue;
      const ddx = p.x - c.x, ddz = p.z - c.z;
      const d = Math.hypot(ddx, ddz), min = c.r + pr;
      if (d < min && d > 1e-6) {
        p.x = c.x + (ddx / d) * min;
        p.z = c.z + (ddz / d) * min;
      }
    }
  }
  return p;
}

/** Add a solid circle after start-up (pillars, stones). */
export function addCircle(x: number, z: number, r: number): Circle {
  const c = { x, z, r };
  hadd(c);
  return c;
}

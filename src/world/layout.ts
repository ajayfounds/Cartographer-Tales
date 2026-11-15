// Pure world data: where everything is. No rendering imports, so game logic,
// the map panel and tests can all share it.
// Axes: +x east, +z south, north is -z. Units are metres. The Vault is the origin.

export type ZoneId = 1 | 2 | 3 | 4 | 5;
export const ZONE_IDS: ZoneId[] = [1, 2, 3, 4, 5];

export const WORLD_RADIUS = 180;
export const RING_ROAD_R = 70;

export const ZONES: Record<ZoneId, { cx: number; cz: number; r: number }> = {
  1: { cx: 0, cz: 128, r: 36 },
  2: { cx: -135, cz: 0, r: 46 },
  3: { cx: 125, cz: 0, r: 48 },
  4: { cx: 0, cz: -125, r: 38 },
  5: { cx: 0, cz: 0, r: 24 },
};

export function zoneAt(x: number, z: number): ZoneId | 0 {
  for (const id of ZONE_IDS) {
    const zn = ZONES[id];
    if (Math.hypot(x - zn.cx, z - zn.cz) <= zn.r) return id;
  }
  return 0;
}

export const SPAWN = { x: 0, z: 152, yaw: Math.PI }; // facing north

export interface DiscoveryPoint {
  id: string;
  zone: ZoneId;
  x: number;
  z: number;
  label: string;
  textId: string;
  optional: boolean;
  /** key points are only discovered by interacting, never by walking past */
  interactOnly?: boolean;
}

export const DISCOVERY_POINTS: DiscoveryPoint[] = [
  { id: 'DP-Z1-01', zone: 1, x: 5, z: 146, label: 'Broken signpost', textId: 'z1.signpost', optional: false },
  { id: 'DP-Z1-02', zone: 1, x: -14, z: 126, label: 'Old campsite', textId: 'z1.letter', optional: false },
  { id: 'DP-Z1-03', zone: 1, x: 24, z: 133, label: 'Rusted theodolite', textId: 'z1.theodolite', optional: true },
  { id: 'DP-Z1-04', zone: 1, x: 0, z: 96, label: "First survey's cairn", textId: 'z1.cairn', optional: true },

  { id: 'DP-Z2-01', zone: 2, x: -116, z: -43, label: 'Spring head', textId: 'z2.spring', optional: false },
  { id: 'DP-Z2-02', zone: 2, x: -147.5, z: -20, label: 'Hidden terrace', textId: 'z2.carvings', optional: false, interactOnly: true },
  { id: 'DP-Z2-03', zone: 2, x: -100, z: 22, label: 'Drowned figure', textId: 'z2.statue', optional: true },
  { id: 'DP-Z2-04', zone: 2, x: -98, z: -16, label: 'Tally stones', textId: 'z2.tally', optional: true },

  { id: 'DP-Z3-01', zone: 3, x: 92, z: 4, label: 'First chime', textId: 'z3.chime', optional: false },
  { id: 'DP-Z3-02', zone: 3, x: 148, z: 26, label: 'Marker in the clearing', textId: 'z3.grave', optional: false, interactOnly: true },
  { id: 'DP-Z3-03', zone: 3, x: 110, z: 26, label: 'Standing stones', textId: 'z3.stones', optional: true },
  { id: 'DP-Z3-04', zone: 3, x: 146, z: -22, label: 'Hollow pine', textId: 'z3.hollow', optional: true },

  { id: 'DP-Z4-01', zone: 4, x: 0, z: -90, label: 'Route slab', textId: 'z4.slab', optional: false },
  { id: 'DP-Z4-02', zone: 4, x: 0, z: -125, label: 'Summit mark', textId: 'z4.summit', optional: false, interactOnly: true },
  { id: 'DP-Z4-03', zone: 4, x: -35, z: -112, label: 'Fallen lens', textId: 'z4.lens', optional: true },
  { id: 'DP-Z4-04', zone: 4, x: -17.4, z: -131.3, label: 'Rope cache', textId: 'z4.cache', optional: true },

  { id: 'DP-Z5-01', zone: 5, x: 4.5, z: 27.5, label: 'Vault gate', textId: 'z5.gate', optional: false },
  { id: 'DP-Z5-02', zone: 5, x: 2.2, z: 1.2, label: "The last log", textId: 'z5.log', optional: false, interactOnly: true },
  { id: 'DP-Z5-03', zone: 5, x: -15.5, z: -15.5, label: "Founders' frieze", textId: 'z5.frieze', optional: true },
];

// ---- Zone 1: survey stakes --------------------------------------------------
// Vane directions are eighths of a turn: 0=N, 1=NE, 2=E ... 7=NW.
export const CAIRN = { x: 0, z: 96 };
export const STAKES = [
  { x: -20, z: 116, target: 1, initial: 4 },
  { x: 20, z: 116, target: 7, initial: 2 },
  { x: 0, z: 128, target: 0, initial: 5 },
];
export const TRAILHEAD_GAP = { angle: -Math.PI / 2, width: 9 }; // north side of zone 1

// ---- Zone 2: sluice gates and pools ----------------------------------------
export const GATES = {
  A: { x: -116, z: -33 },
  B: { x: -116, z: 6 },
  C: { x: -158, z: 18 },
};
export const POOL1 = { x0: -150, x1: -122, z0: -30, z1: -10, floor: -3.2, full: -0.35, ramp: 8 };
export const POOL2 = { x0: -148, x1: -122, z0: 10, z1: 30, floor: -2.2, full: -0.35, ramp: 5 };
/** Channel polylines, keyed by segment name used in logic.gateFlow(). */
export const CHANNELS: Record<string, [number, number][]> = {
  spring: [[-116, -43], [-116, -33]],
  A_L: [[-116, -33], [-136, -33], [-136, -30]],
  A_R: [[-116, -33], [-116, 6]],
  B_L: [[-116, 6], [-116, 14], [-122, 14]],
  B_R: [[-116, 6], [-154, 6], [-154, 18], [-158, 18]],
  C_L: [[-158, 18], [-164, 18], [-164, -20], [-150, -20]],
  C_R: [[-158, 18], [-158, 40]],
};

// ---- Zone 3: chimes ---------------------------------------------------------
export const CHIMES = [
  { x: 92, z: 4 },
  { x: 106, z: -16 },
  { x: 124, z: -22 },
  { x: 138, z: -6 },
  { x: 132, z: 14 },
  { x: 148, z: 26 }, // hangs over the grave
];
export const CHIME_REACH = 7;
export const GRAVE = { x: 148, z: 26 };
export const LOCKET = { x: 149.6, z: 27.8 };

// ---- Zone 4: the stepped hill ----------------------------------------------
export const MESA = { cx: 0, cz: -125, radii: [30, 22, 15, 9], step: 4 };
export type HoldGlyph = 'ring' | 'bars' | 'star';
/** holds[tier] = three holds at an angle (degrees, 90 = due south) */
export const HOLDS: { deg: number; glyph: HoldGlyph }[][] = [
  [{ deg: 90, glyph: 'bars' }, { deg: 58, glyph: 'ring' }, { deg: 124, glyph: 'star' }],
  [{ deg: 36, glyph: 'star' }, { deg: 76, glyph: 'ring' }, { deg: 112, glyph: 'bars' }],
  [{ deg: 84, glyph: 'ring' }, { deg: 132, glyph: 'bars' }, { deg: 166, glyph: 'star' }],
  [{ deg: 56, glyph: 'bars' }, { deg: 100, glyph: 'star' }, { deg: 144, glyph: 'ring' }],
];

// ---- Zone 5: the Vault ------------------------------------------------------
export const VAULT = {
  wallR: 24,
  gateAngle: Math.PI / 2, // south
  gateWidth: 6,
  sealR: 5,
  dials: [{ x: -2.6, z: 7.6 }, { x: 2.6, z: 7.6 }],
  table: { x: 0, z: 0 },
  compass: { x: -3.4, z: -1.6 },
};

// Everything you can see that is not the player: terrain, trees, the five
// zones' props, water, and the visual side of each puzzle. All geometry is
// generated here, so the game ships with no third-party art.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  TERRAIN_SIZE, TERRAIN_SEG, heightGrid, heightAt, groundAt, trees, rng, ringWalls, props, addCircle, boxes,
  type Ground,
} from './terrain';
import {
  STAKES, CAIRN, GATES, POOL1, POOL2, CHANNELS, CHIMES, GRAVE, LOCKET, MESA, HOLDS, VAULT, ZONES, zoneAt,
  RING_ROAD_R, type ZoneId,
} from './layout';
import { gateFlow, vaultUnlocked, stakeAligned, GLYPHS, CLIMB_ROUTE, type GameState, type Glyph } from '../core/logic';
import { drawGlyph } from '../ui/glyphs';
import { story } from '../content';

const C = {
  stone: 0xc4b392, stoneDark: 0x9c8d74, stoneLight: 0xdccdaa, wood: 0x6b4f36, woodPale: 0xa88a62,
  brass: 0xdcae4c, canvas: 0xcdb27a, water: 0x3fb3ad, slate: 0x4a5058, paper: 0xe9e1cb, rope: 0x8d7c5c,
  moss: 0x66755a, ember: 0x3a3632, mossTop: 0x86a04a,
};
const GROUND: Record<Ground, number> = {
  grass: 0x7da34c, road: 0xd2b782, stone: 0xc6b693, basin: 0x94a088, rock: 0x90a455, needles: 0x567a4c, court: 0xd8c79e,
};
const ATMOS: Record<number, { sky: number; fog: number; top: number }> = {
  0: { sky: 0xf0d8c2, fog: 0.0052, top: 0x6f8fd6 },
  1: { sky: 0xf4dcb8, fog: 0.006, top: 0x6f93d8 },
  2: { sky: 0xd8e6ea, fog: 0.006, top: 0x5f9bdc },
  3: { sky: 0xa9b8c8, fog: 0.04, top: 0x8ea2bc },
  4: { sky: 0xf2cfc4, fog: 0.0035, top: 0x7a86d4 },
  5: { sky: 0xf6dca8, fog: 0.0048, top: 0x8a8fd0 },
};

const mats = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
}
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glyphTex(glyphs: Glyph[], bg: string, fg: string, vertical = false): THREE.CanvasTexture {
  const n = glyphs.length;
  return canvasTex(vertical ? 128 : 128 * n, vertical ? 128 * n : 128, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    glyphs.forEach((g, i) => drawGlyph(ctx, g, vertical ? 14 : 14 + i * 128, vertical ? 14 + i * 128 : 14, 100, fg));
  });
}

export class World {
  readonly root = new THREE.Group();
  private shadows: boolean;
  private stakeGroups: THREE.Group[] = [];
  private stakeVanes: THREE.Group[] = [];
  private threads: THREE.Mesh[] = [];
  private hurdle!: THREE.Group;
  private gatePointers: Record<string, THREE.Object3D> = {};
  private gateWheels: Record<string, THREE.Object3D> = {};
  private channelWater: Record<string, THREE.Object3D[]> = {};
  private poolMesh: THREE.Mesh[] = [];
  private level = [POOL1.full, POOL2.floor - 0.2];
  private target = [POOL1.full, POOL2.floor - 0.2];
  private chimeTubes: THREE.Group[] = [];
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private beams: THREE.Mesh[] = [];
  private locket!: THREE.Object3D;
  private compass!: THREE.Object3D;
  private vaultDoor!: THREE.Object3D;
  private seal!: THREE.Object3D;
  private tableGroup!: THREE.Group;
  private dialDiscs: THREE.Mesh[] = [];
  private dialTex: THREE.CanvasTexture[] = [];
  private placedMap!: THREE.Object3D;
  private outfall!: THREE.Object3D;
  private motes?: THREE.Points;
  private blockN = 0;
  private lush = 1;
  private batchable: THREE.Mesh[] = [];
  private bannerTex?: THREE.CanvasTexture;
  private haloTex?: THREE.CanvasTexture;
  private fallTex?: THREE.CanvasTexture;
  private cloths: THREE.Mesh[] = [];
  private glows: THREE.Sprite[] = [];
  private flames: THREE.Mesh[] = [];
  private sky!: THREE.Mesh;
  private farMat!: THREE.MeshBasicMaterial;
  private clouds!: THREE.Mesh;
  private vaultBeam!: THREE.Mesh;
  private armillary!: THREE.Group;
  private armGlow!: THREE.Sprite;
  private sealY = 0;
  private vaultIsOpen = false;
  private activeChime = 0;
  private atmosZone = 0;
  private fogNow = ATMOS[0].fog;
  private skyNow = new THREE.Color(ATMOS[0].sky);
  /** set by the camera during the summit shot: thins the fog so the whole region shows */
  clearAir = 0;

  constructor(private scene: THREE.Scene, opts: { shadows: boolean; motes: boolean }) {
    this.lush = opts.motes ? 1 : 0.45;
    this.shadows = opts.shadows;
    scene.add(this.root);
    scene.background = this.skyNow.clone();
    scene.fog = new THREE.FogExp2(this.skyNow.getHex(), this.fogNow);
    this.buildSky();
    this.buildTerrain();
    this.buildTrees();
    this.buildScatter();
    this.buildZone1();
    this.buildZone2();
    this.buildZone3();
    this.buildZone4();
    this.buildZone5();
    this.dressZones();
    this.buildFlora();
    this.buildFx(opts.motes);
    this.batchStatics();
  }

  // ---- helpers --------------------------------------------------------------
  private add<T extends THREE.Object3D>(o: T, parent: THREE.Object3D = this.root): T {
    parent.add(o);
    if (this.shadows && (o as unknown as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    return o;
  }
  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0, parent?: THREE.Object3D) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.batchable.push(m);
    return this.add(m, parent);
  }
  private cyl(rt: number, rb: number, h: number, color: number, x: number, y: number, z: number, seg = 8, parent?: THREE.Object3D) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
    m.position.set(x, y, z);
    this.batchable.push(m);
    return this.add(m, parent);
  }
  private plaque(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number, parent?: THREE.Object3D) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    (parent ?? this.root).add(m);
    return m;
  }

  // ---- terrain --------------------------------------------------------------
  private buildTerrain() {
    const n = TERRAIN_SEG + 1, half = TERRAIN_SIZE / 2, cell = TERRAIN_SIZE / TERRAIN_SEG;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const rand = rng(7);
    const c = new THREE.Color(), cliff = new THREE.Color(0x8a7f92), gold = new THREE.Color(0xc4b44c), mossC = new THREE.Color(0x7f9c4a);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = -half + i * cell, z = -half + j * cell, y = heightGrid[k];
      pos.set([x, y, z], k * 3);
      const gk = groundAt(x, z);
      c.setHex(GROUND[gk]);
      if (gk === 'stone' || gk === 'court') {
        const slab = ((Math.floor(x / 3) * 7 + Math.floor(z / 3) * 13) & 7) / 7;
        c.multiplyScalar(0.9 + slab * 0.14);
        const m = Math.sin(x * 0.21 + 1.3) * Math.sin(z * 0.17) + Math.sin(x * 0.05 + z * 0.08);
        if (m > 0.75) c.lerp(mossC, Math.min(0.75, (m - 0.75) * 1.6));
      }
      if (gk === 'grass' || gk === 'rock') c.lerp(gold, (0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2)) * 0.38);
      const hx = heightGrid[j * n + Math.min(i + 1, n - 1)] - heightGrid[j * n + Math.max(i - 1, 0)];
      const hz = heightGrid[Math.min(j + 1, n - 1) * n + i] - heightGrid[Math.max(j - 1, 0) * n + i];
      const steep = Math.min(1, Math.hypot(hx, hz) / 3.2);
      c.lerp(cliff, steep * 0.9);
      const v = 0.93 + rand() * 0.14;
      col.set([c.r * v, c.g * v, c.b * v], k * 3);
    }
    const idx = new Uint32Array(TERRAIN_SEG * TERRAIN_SEG * 6);
    let p = 0;
    for (let j = 0; j < TERRAIN_SEG; j++) for (let i = 0; i < TERRAIN_SEG; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      idx.set([a, cc, b, b, cc, d], p);
      p += 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = this.shadows;
    this.root.add(mesh);
  }

  private buildTrees() {
    const prep = (g: THREE.BufferGeometry, color: number, y: number, rz = 0, x = 0) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.rotateZ(rz);
      ng.translate(x, y, 0);
      const c = new THREE.Color(color), n = ng.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      ng.deleteAttribute('uv');
      return ng;
    };
    const geos = {
      pine: mergeGeometries([
        prep(new THREE.CylinderGeometry(0.13, 0.22, 5.4, 6), 0x7a5a42, 2.7),
        prep(new THREE.ConeGeometry(1.9, 3.4, 7), 0x2f6145, 6.2),
        prep(new THREE.ConeGeometry(1.45, 3.0, 7), 0x3a7250, 8.1),
        prep(new THREE.ConeGeometry(0.9, 2.6, 7), 0x4a8458, 9.9),
      ]),
      birch: mergeGeometries([
        prep(new THREE.CylinderGeometry(0.16, 0.28, 3.6, 6), 0x6b4f36, 1.8),
        prep(new THREE.IcosahedronGeometry(2.1, 1), 0x7fae3e, 4.9),
        prep(new THREE.IcosahedronGeometry(1.5, 1), 0x9cbc44, 5.9, 0, 1.2),
        prep(new THREE.IcosahedronGeometry(1.4, 1), 0x6a9c3c, 5.2, 0, -1.3),
      ]),
      dead: mergeGeometries([
        prep(new THREE.CylinderGeometry(0.14, 0.26, 3.8, 6), 0x5c4433, 1.9),
        prep(new THREE.IcosahedronGeometry(1.9, 1), 0xd2b23c, 5.0),
        prep(new THREE.IcosahedronGeometry(1.3, 1), 0xe2c650, 6.0, 0, 0.9),
        prep(new THREE.IcosahedronGeometry(1.2, 1), 0xb99a34, 4.8, 0, -1.2),
      ]),
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    const rand = rng(99);
    for (const kind of ['pine', 'birch', 'dead'] as const) {
      const list = trees.filter((t) => t.kind === kind);
      const im = new THREE.InstancedMesh(geos[kind], new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m4.compose(new THREE.Vector3(t.x, heightAt(t.x, t.z) - 0.15, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + rand() * 0.3), t.s));
        im.setMatrixAt(i, m4);
        const v = 0.82 + rand() * 0.3;
        im.setColorAt(i, tint.setRGB(v, v, v * (0.95 + rand() * 0.1)));
      });
      im.frustumCulled = false;
      im.castShadow = this.shadows;
      this.root.add(im);
    }
  }

  private buildScatter() {
    // loose rocks (no collision) and the four obelisks where the roads meet the ring
    const rand = rng(1234);
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), mat(0x8f8a80), 260);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 260; i++) {
      const a = rand() * 6.283, r = 30 + Math.sqrt(rand()) * 146;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.3 + rand() * 0.9;
      q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3));
      const inBasin = groundAt(x, z) === 'basin';
      m4.compose(new THREE.Vector3(x, heightAt(x, z) + (inBasin ? -5 : s * 0.1), z), q, new THREE.Vector3(s, s * 0.6, s));
      im.setMatrixAt(i, m4);
    }
    im.frustumCulled = false;
    this.root.add(im);
    for (const [x, z] of [[RING_ROAD_R + 4, 4.5], [-RING_ROAD_R - 4, -4.5], [4.5, -RING_ROAD_R - 4], [-4.5, RING_ROAD_R + 4]]) {
      const y = heightAt(x, z);
      this.box(1.5, 0.5, 1.5, C.stoneDark, x, y + 0.25, z);
      const ob = this.cyl(0.25, 0.55, 5, C.stoneLight, x, y + 3, z, 4);
      ob.rotation.y = Math.PI / 4;
      addCircle(x, z, 0.8);
    }
  }

  // ---- zone 1: the Trailhead ------------------------------------------------
  private buildZone1() {
    const g = (x: number, z: number) => heightAt(x, z);
    // broken signpost
    let y = g(5, 146);
    this.cyl(0.09, 0.11, 2.2, C.wood, 5, y + 1.1, 146, 5);
    const board = this.box(1.5, 0.4, 0.06, C.woodPale, 5.3, y + 1.8, 146, 0.4);
    board.rotation.z = -0.22;
    const fallen = this.box(1.1, 0.35, 0.06, C.woodPale, 6.2, y + 0.1, 146.8, 1.1);
    fallen.rotation.x = Math.PI / 2;
    // camp: tent, fire ring, the letter under a stone
    y = g(-17, 128);
    const tent = this.add(new THREE.Mesh(new THREE.ConeGeometry(2, 2.2, 4), mat(C.canvas)));
    tent.position.set(-17, y + 1.1, 128);
    tent.rotation.y = 0.6;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283;
      this.cyl(0.22, 0.26, 0.22, C.stoneDark, -12.5 + Math.cos(a) * 0.9, g(-12.5, 124.5) + 0.1, 124.5 + Math.sin(a) * 0.9, 5);
    }
    this.cyl(0.6, 0.6, 0.06, C.ember, -12.5, g(-12.5, 124.5) + 0.03, 124.5, 8);
    const log = this.cyl(0.2, 0.2, 1.6, C.wood, -11, g(-11, 126.6) + 0.2, 126.6, 6);
    log.rotation.z = Math.PI / 2;
    y = g(-14, 126);
    this.box(0.5, 0.02, 0.36, C.paper, -14, y + 0.03, 126, 0.3);
    this.cyl(0.16, 0.2, 0.14, C.stoneDark, -14, y + 0.09, 126, 5);
    // rusted theodolite
    y = g(24, 133);
    for (let i = 0; i < 3; i++) {
      const leg = this.cyl(0.03, 0.03, 1.5, C.wood, 24 + Math.cos(i * 2.094) * 0.3, y + 0.68, 133 + Math.sin(i * 2.094) * 0.3, 4);
      leg.rotation.z = Math.cos(i * 2.094) * -0.4;
      leg.rotation.x = Math.sin(i * 2.094) * 0.4;
    }
    const scope = this.cyl(0.07, 0.09, 0.5, 0x7a6a3c, 24, y + 1.5, 133, 6);
    scope.rotation.z = 1.2;
    this.cyl(0.16, 0.16, 0.08, 0x7a6a3c, 24, y + 1.36, 133, 8);
    // cairn
    y = g(CAIRN.x, CAIRN.z);
    for (let i = 0; i < 6; i++) this.cyl(0.75 - i * 0.1, 0.8 - i * 0.1, 0.24, i % 2 ? C.stone : C.stoneDark, CAIRN.x + (i % 2) * 0.05, y + 0.12 + i * 0.24, CAIRN.z, 6);
    // stakes with sighting vanes
    STAKES.forEach((s, i) => {
      const grp = new THREE.Group();
      grp.position.set(s.x, g(s.x, s.z), s.z);
      this.root.add(grp);
      this.cyl(0.05, 0.06, 1.3, C.woodPale, 0, 0.65, 0, 5, grp);
      this.cyl(0.07, 0.07, 0.1, 0xb0452f, 0, 1.2, 0, 5, grp); // painted band (shape + colour)
      const vane = new THREE.Group();
      vane.position.y = 1.36;
      grp.add(vane);
      this.box(0.06, 0.04, 1.0, C.brass, 0, 0, -0.2, 0, vane);
      const tip = this.add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), mat(C.brass)), vane);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.8;
      this.cyl(0.12, 0.12, 0.05, C.brass, 0, 0, 0.3, 8, vane);
      this.stakeGroups.push(grp);
      this.stakeVanes.push(vane);
      // sight line to the cairn, shown when this stake is on target
      const from = new THREE.Vector3(s.x, g(s.x, s.z) + 1.36, s.z), to = new THREE.Vector3(CAIRN.x, g(CAIRN.x, CAIRN.z) + 1.5, CAIRN.z);
      const len = from.distanceTo(to);
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4), new THREE.MeshBasicMaterial({ color: 0xfff1c0, fog: false }));
      th.position.copy(from).lerp(to, 0.5);
      th.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      this.root.add(th);
      this.threads.push(th);
    });
    // the woven hurdle across the gap
    this.hurdle = new THREE.Group();
    this.root.add(this.hurdle);
    const hy = g(0, 92);
    for (let i = -4; i <= 4; i++) {
      this.cyl(0.07, 0.09, 2.6, C.wood, i * 1.05, hy + 1.3, 92 + Math.sin(i * 1.7) * 0.3, 5, this.hurdle);
      const br = this.box(1.3, 0.09, 0.09, C.rope, i * 1.05 + 0.5, hy + 0.7 + ((i + 4) % 3) * 0.6, 92, 0, this.hurdle);
      br.rotation.z = ((i % 2) - 0.5) * 0.5;
      const leaf = this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), mat(0x5b6b55)), this.hurdle);
      leaf.position.set(i * 1.05, hy + 2.3 + Math.cos(i * 2.3) * 0.3, 92.2);
    }
  }

  // ---- zone 2: the Flooded Terraces ----------------------------------------
  private buildZone2() {
    // walls
    this.box(49, 2.2, 2, C.stone, -146.5, 1.1, 9);
    this.box(49, 2.2, 2, C.stone, -146.5, 1.1, 31);
    this.box(2, 1.3, 24, C.stone, -171, 0.65, 20);
    // broken columns along the plaza's east edge
    const rand = rng(22);
    for (let i = 0; i < 7; i++) {
      const x = -92, z = -40 + i * 13.5;
      if (Math.abs(z) < 5) continue;
      const h = 1.2 + rand() * 3.5;
      this.cyl(0.55, 0.62, h, C.stoneLight, x, h / 2, z, 8);
      this.box(1.5, 0.3, 1.5, C.stone, x, 0.15, z);
      addCircle(x, z, 0.85);
    }
    // channels: a stone trough per segment, plus a water strip that shows when it flows
    const waterMat = new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.85, flatShading: true });
    for (const [name, pts] of Object.entries(CHANNELS)) {
      this.channelWater[name] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        this.box(len + 1.3, 0.22, 1.3, C.stoneDark, mx, 0.11, mz, ry);
        this.box(len + 0.7, 0.04, 0.7, 0x4b4f4c, mx, 0.225, mz, ry);
        const w = new THREE.Mesh(new THREE.BoxGeometry(len + 0.7, 0.05, 0.7), waterMat);
        w.position.set(mx, 0.26, mz);
        w.rotation.y = ry;
        this.root.add(w);
        this.channelWater[name].push(w);
      }
    }
    // spring head
    this.box(3, 2.6, 1.6, C.stone, -116, 1.3, -45);
    this.box(1, 1, 0.3, 0x3b4446, -116, 0.9, -44.1);
    this.box(3.6, 0.4, 2, C.stoneLight, -116, 2.8, -45);
    // gates: block, wheel on a post, and a brass pointer showing which way the water goes
    for (const id of ['A', 'B', 'C'] as const) {
      const p = GATES[id];
      this.box(1.7, 0.7, 1.7, C.stone, p.x, 0.35, p.z);
      const pointer = new THREE.Group();
      pointer.position.set(p.x, 0.85, p.z);
      this.root.add(pointer);
      this.box(1.5, 0.12, 0.22, C.brass, 0.45, 0, 0, 0, pointer);
      const tip = this.add(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 4), mat(C.brass)), pointer);
      tip.rotation.z = -Math.PI / 2;
      tip.position.x = 1.35;
      this.cyl(0.2, 0.2, 0.2, C.brass, 0, 0, 0, 8, pointer);
      this.gatePointers[id] = pointer;
      this.box(0.3, 1.5, 0.3, C.wood, p.x + 1.4, 0.75, p.z);
      const wheel = new THREE.Group();
      wheel.position.set(p.x + 1.4, 1.45, p.z + 0.22);
      this.root.add(wheel);
      this.add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 6, 16), mat(C.wood)), wheel);
      for (let k = 0; k < 4; k++) this.box(1.4, 0.09, 0.07, C.woodPale, 0, 0, 0, 0, wheel).rotation.z = (k * Math.PI) / 4;
      this.cyl(0.16, 0.16, 0.16, C.brass, 0, 0, 0, 8, wheel).rotation.x = Math.PI / 2;
      this.gateWheels[id] = wheel;
    }
    // pool water
    for (const [i, pool] of [POOL1, POOL2].entries()) {
      const w = pool.x1 - pool.x0, d = pool.z1 - pool.z0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.78 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set((pool.x0 + pool.x1) / 2, this.level[i], (pool.z0 + pool.z1) / 2);
      this.root.add(m);
      this.poolMesh.push(m);
    }
    // the hidden terrace: carved wall at the west end of pool 1
    this.box(0.5, 3.2, 9, C.stoneDark, -148.6, -1.6, -20);
    const carve = canvasTex(512, 256, (ctx) => {
      ctx.fillStyle = '#7d7b72';
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#3d3c38';
      ctx.lineWidth = 3;
      for (let r = 30; r < 240; r += 26) {
        ctx.beginPath();
        ctx.ellipse(256, 128, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(20, 128); ctx.lineTo(492, 128); ctx.moveTo(256, 8); ctx.lineTo(256, 248);
      ctx.stroke();
      ctx.fillStyle = '#7d7b72';
      ctx.fillRect(206, 78, 100, 100);
      drawGlyph(ctx, 'wave', 211, 83, 90, '#2a2926');
    });
    this.plaque(carve, 7.5, 2.9, -148.33, -1.65, -20, Math.PI / 2);
    // drowned figure in its shallow pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(3.4, 20), new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.8 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-100, 0.06, 22);
    this.root.add(pond);
    this.cyl(0.4, 0.7, 2.4, C.stoneLight, -100, 1.2, 22, 7);
    const head = this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), mat(C.stoneLight)));
    head.position.set(-100, 2.75, 22);
    this.cyl(0.05, 0.05, 4.2, C.stoneDark, -99.3, 2.1, 22.2, 5);
    // tally stones
    for (let i = 0; i < 6; i++) this.box(0.5, 0.5 + (i % 3) * 0.12, 0.3, i === 5 ? C.stoneLight : C.stone, -100.5 + i, 0.3, -16, 0.1 * (i % 2));
    // outfall: a sink the last channel drops into
    const sink = new THREE.Mesh(new THREE.CircleGeometry(2.2, 14), mat(0x2f3436));
    sink.rotation.x = -Math.PI / 2;
    sink.position.set(-158, 0.03, 42);
    this.root.add(sink);
    for (let i = 0; i < 9; i++) this.box(0.9, 0.5, 0.6, C.stoneDark, -158 + Math.cos(i * 0.7 - 0.2) * 2.4, 0.25, 42 + Math.sin(i * 0.7 - 0.2) * 2.4, -i * 0.7);
    this.outfall = this.box(0.6, 0.05, 2.4, C.water, -158, 0.2, 40.9);
  }

  // ---- zone 3: the Whisper Pines -------------------------------------------
  private buildZone3() {
    CHIMES.forEach((c, i) => {
      const y = heightAt(c.x, c.z);
      const last = i === CHIMES.length - 1;
      const px = c.x + (last ? 1.6 : 0), pz = c.z + (last ? -1.4 : 0);
      this.cyl(0.06, 0.08, 3, C.wood, px, y + 1.5, pz, 5);
      this.box(1.1, 0.07, 0.07, C.wood, px + 0.45, y + 2.9, pz);
      const tubes = new THREE.Group();
      tubes.position.set(px + 0.8, y + 2.85, pz);
      this.root.add(tubes);
      for (let k = 0; k < 5; k++) this.cyl(0.03, 0.03, 0.5 + k * 0.09, C.brass, Math.cos(k * 1.257) * 0.13, -0.35 - k * 0.045, Math.sin(k * 1.257) * 0.13, 5, tubes);
      this.chimeTubes.push(tubes);
      if (!last) addCircle(px, pz, 0.25);
    });
    // standing stones
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283, x = 110 + Math.cos(a) * 5.2, z = 26 + Math.sin(a) * 5.2;
      const s = this.box(0.9, 1.7, 0.45, C.stoneDark, x, heightAt(x, z) + 0.8, z, -a + Math.PI / 2);
      s.rotation.z = Math.sin(i * 3) * 0.06;
      addCircle(x, z, 0.6);
    }
    // hollow pine with the satchel
    let y = heightAt(146, -22);
    this.cyl(0.8, 1.1, 3.4, 0x5a5148, 147.2, y + 1.7, -22.6, 7);
    this.box(0.5, 0.4, 0.25, C.rope, 146.3, y + 0.5, -22.1, 0.5);
    addCircle(147.2, -22.6, 1.15);
    // the grave
    y = heightAt(GRAVE.x, GRAVE.z);
    const slate = canvasTex(256, 320, (ctx) => {
      ctx.fillStyle = '#4a5058';
      ctx.fillRect(0, 0, 256, 320);
      ctx.fillStyle = '#c9ced2';
      ctx.textAlign = 'center';
      ctx.font = '600 26px Georgia, serif';
      ctx.fillText(story.cast.partner.toUpperCase(), 128, 60);
      ctx.font = '16px Georgia, serif';
      ctx.fillText('CARTOGRAPHER', 128, 92);
      ctx.fillText('SHE WAS RIGHT TO LOOK', 128, 122);
      drawGlyph(ctx, 'fork', 78, 160, 100, '#c9ced2');
    });
    this.box(1.15, 1.5, 0.16, C.slate, GRAVE.x, y + 0.75, GRAVE.z - 0.5);
    this.plaque(slate, 1.1, 1.4, GRAVE.x, y + 0.78, GRAVE.z - 0.41, 0);
    this.box(1.3, 0.12, 2.1, 0x67705c, GRAVE.x, y + 0.06, GRAVE.z + 0.75);
    this.locket = new THREE.Group();
    this.root.add(this.locket);
    this.cyl(0.3, 0.34, 0.1, C.stone, LOCKET.x, heightAt(LOCKET.x, LOCKET.z) + 0.05, LOCKET.z, 6, this.locket);
    this.cyl(0.1, 0.1, 0.03, C.brass, LOCKET.x + 0.28, heightAt(LOCKET.x, LOCKET.z) + 0.04, LOCKET.z + 0.2, 10, this.locket);
  }

  // ---- zone 4: the Shattered Overlook --------------------------------------
  private buildZone4() {
    // route slab at the foot
    const y0 = heightAt(0, -90);
    this.box(1.4, 2.6, 0.3, C.stoneDark, 1.6, y0 + 1.3, -91.2);
    this.plaque(glyphTex([...CLIMB_ROUTE].reverse(), '#7d7b72', '#22211f', true), 0.55, 2.2, 1.6, y0 + 1.35, -91.04, 0);
    HOLDS.forEach((tier, t) => {
      const R = MESA.radii[t];
      tier.forEach((h) => {
        const a = (h.deg * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a), tx = -dz, tz = dx;
        const base = heightAt(MESA.cx + dx * (R + 2.6), MESA.cz + dz * (R + 2.6));
        const face = Math.atan2(dx, dz);
        // cut rungs leaning up the face
        for (let k = 0; k < 6; k++) {
          const rr = R + 1.7 - k * 0.5;
          this.box(0.9, 0.12, 0.28, C.stoneLight, MESA.cx + dx * rr, base + 0.5 + k * 0.66, MESA.cz + dz * rr, face);
        }
        // marker stele beside the rungs, with the hold's mark and a piton ring
        const sx = MESA.cx + dx * (R + 2.3) + tx * 1.25, sz = MESA.cz + dz * (R + 2.3) + tz * 1.25;
        this.box(0.85, 1.9, 0.26, C.stoneDark, sx, base + 0.95, sz, face);
        this.plaque(glyphTex([h.glyph], '#8f8c82', '#1f1e1c'), 0.62, 0.62, sx + dx * 0.14, base + 1.35, sz + dz * 0.14, face);
        const ring = this.add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 4, 8), mat(0x5c5a55)));
        ring.position.set(sx + dx * 0.16, base + 0.75, sz + dz * 0.16);
        ring.rotation.y = face;
        addCircle(sx, sz, 0.5);
      });
    });
    // fallen lens
    let y = heightAt(-35, -112);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 14), new THREE.MeshLambertMaterial({ color: 0xb9d6d8, transparent: true, opacity: 0.7 }));
    lens.position.set(-35, y + 0.35, -112);
    lens.rotation.set(0.35, 0, 0.2);
    this.root.add(lens);
    const rim = this.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 5, 14), mat(C.brass)));
    rim.position.copy(lens.position);
    rim.rotation.set(0.35 + Math.PI / 2, 0.2, 0);
    // rope cache on the second tier
    y = heightAt(-17.4, -131.3);
    const coil = this.add(new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.1, 5, 10), mat(C.rope)));
    coil.position.set(-17.4, y + 0.12, -131.3);
    coil.rotation.x = Math.PI / 2;
    this.box(0.08, 0.3, 0.08, 0x5c5a55, -17, y + 0.15, -131);
    // summit: brass mark and the stubs of what once stood here
    y = heightAt(MESA.cx, MESA.cz);
    this.cyl(0.9, 0.9, 0.06, C.brass, MESA.cx, y + 0.03, MESA.cz, 16);
    this.cyl(1.3, 1.3, 0.04, C.stoneLight, MESA.cx, y + 0.015, MESA.cz, 16);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.571 + 0.785, x = MESA.cx + Math.cos(a) * 5, z = MESA.cz + Math.sin(a) * 5;
      this.cyl(0.4, 0.5, 1 + i * 0.7, C.stoneLight, x, y + (1 + i * 0.7) / 2, z, 7);
      addCircle(x, z, 0.6);
    }
  }

  // ---- zone 5: the Vault ----------------------------------------------------
  private buildZone5() {
    const R = VAULT.wallR, gapA = VAULT.gateWidth / R;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 4.2, 72, 1, true, gapA / 2, Math.PI * 2 - gapA),
      new THREE.MeshLambertMaterial({ color: C.stoneLight, flatShading: true, side: THREE.DoubleSide }),
    );
    wall.position.y = 2.1;
    this.add(wall);
    const cap = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 4, 72), mat(C.stone));
    cap.rotation.x = Math.PI / 2;
    cap.position.y = 4.2;
    this.add(cap);
    this.box(1.1, 4.6, 1.1, C.stone, -3.5, 2.3, R);
    this.box(1.1, 4.6, 1.1, C.stone, 3.5, 2.3, R);
    this.box(8.4, 0.8, 1.3, C.stone, 0, 4.9, R);
    this.vaultDoor = this.box(6, 4.2, 0.5, C.stoneDark, 0, 2.1, R);
    this.plaque(glyphTex(['ring'], '#7d7b72', '#2a2926'), 1.6, 1.6, 0, 2.3, R + 0.27, 0, this.vaultDoor.parent!).visible = false;
    // pillars
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283 + 0.262, x = Math.cos(a) * 13, z = Math.sin(a) * 13;
      this.cyl(0.5, 0.6, 5, C.stoneLight, x, 2.5, z, 8);
      this.box(1.5, 0.4, 1.5, C.stone, x, 0.2, z);
      this.box(1.4, 0.3, 1.4, C.stone, x, 5.1, z);
      addCircle(x, z, 0.8);
    }
    // founders' frieze on the inner wall
    const frieze = canvasTex(512, 128, (ctx) => {
      ctx.fillStyle = '#b5ae98';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = '#5a5648';
      ctx.fillStyle = '#5a5648';
      ctx.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        const x = 30 + i * 56;
        ctx.beginPath(); ctx.arc(x, 44, 8, 0, 6.3); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x, 92); ctx.moveTo(x, 92); ctx.lineTo(x - 9, 118); ctx.moveTo(x, 92); ctx.lineTo(x + 9, 118);
        ctx.moveTo(x, 62); ctx.lineTo(x + 16, 54); ctx.moveTo(x + 16, 20); ctx.lineTo(x + 16, 118); ctx.stroke();
      }
    });
    const fa = Math.atan2(-15.5, -15.5);
    this.plaque(frieze, 7, 1.75, Math.cos(fa) * (R - 0.25), 2.2, Math.sin(fa) * (R - 0.25), Math.atan2(-Math.cos(fa), -Math.sin(fa)));
    // seal, and under it the table
    const sealTex = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#a39f90';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#55524a';
      ctx.lineWidth = 4;
      for (let r = 20; r < 128; r += 22) { ctx.beginPath(); ctx.arc(128, 128, r, 0, 6.3); ctx.stroke(); }
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(128 + Math.cos(i * 0.785) * 124, 128 + Math.sin(i * 0.785) * 124); ctx.stroke(); }
    });
    const sealMat = [mat(C.stone), new THREE.MeshLambertMaterial({ map: sealTex }), mat(C.stone)];
    this.seal = this.add(new THREE.Mesh(new THREE.CylinderGeometry(VAULT.sealR, VAULT.sealR, 1.3, 32), sealMat));
    this.seal.position.y = 0.65;
    this.tableGroup = new THREE.Group();
    this.root.add(this.tableGroup);
    this.cyl(1.7, 1.4, 0.95, C.stoneLight, 0, 0.475, 0, 12, this.tableGroup);
    const mapTex = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#d8cfb4';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#6b5a3c';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(128, 128, 48, 0, 6.3); ctx.stroke();
      ctx.beginPath(); ctx.arc(128, 128, 16, 0, 6.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(128, 10); ctx.lineTo(128, 246); ctx.moveTo(10, 128); ctx.lineTo(246, 128); ctx.stroke();
      for (const [x, y] of [[128, 40], [128, 216], [40, 128], [216, 128]]) { ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.3); ctx.stroke(); }
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshLambertMaterial({ map: mapTex }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.96;
    this.tableGroup.add(top);
    this.box(0.5, 0.08, 0.36, 0x5a4636, 1.25, 1.0, 0.55, 0.5, this.tableGroup); // Tobin's log
    this.placedMap = this.box(1.5, 0.03, 1.1, C.paper, -0.35, 0.99, 0.2, -0.2, this.tableGroup);
    this.cyl(0.4, 0.5, 0.8, C.stone, VAULT.compass.x, 0.4, VAULT.compass.z, 8, this.tableGroup);
    this.compass = this.cyl(0.11, 0.11, 0.05, C.brass, VAULT.compass.x, 0.83, VAULT.compass.z, 10, this.tableGroup);
    // dials
    this.dialTex = GLYPHS.map((g) => glyphTex([g], '#b9b3a0', '#22211f'));
    VAULT.dials.forEach((d) => {
      this.cyl(0.45, 0.6, 1.0, C.stone, d.x, 0.5, d.z, 8);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 20), [mat(C.brass), new THREE.MeshLambertMaterial({ map: this.dialTex[0] }), mat(C.brass)]);
      disc.position.set(d.x, 1.12, d.z);
      disc.rotation.x = 0.5;
      this.root.add(disc);
      this.dialDiscs.push(disc);
    });
  }

  // ---- art-direction layer --------------------------------------------------
  // Everything below follows the owner's concept sheets: warm sandstone ruins
  // with moss caps, red diamond banners, lanterns, waterfalls, a painted sky.
  private stoneTint(i: number) {
    return [0xcdbb98, 0xc2b08e, 0xd6c6a4, 0xb8a888][i & 3];
  }
  private block(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, moss = true, parent?: THREE.Object3D) {
    const b = this.box(w, h, d, this.stoneTint(this.blockN++), x, y + h / 2, z, ry, parent);
    if (moss) this.box(w * 0.94, 0.09, d * 0.94, C.mossTop, x, y + h + 0.035, z, ry, parent);
    return b;
  }
  private pillar(x: number, z: number, h: number, collide = true, y0?: number) {
    const y = y0 ?? heightAt(x, z);
    this.block(1.3, 0.35, 1.3, x, y, z, 0, false);
    let yy = y + 0.35, i = 0;
    while (yy < y + h - 0.01) {
      const seg = Math.min(1.1, y + h - yy);
      this.block(0.95, seg, 0.95, x, yy, z, (i++ % 2) * 0.05, false);
      yy += seg;
    }
    this.block(1.2, 0.3, 1.2, x, y + h, z, 0, true);
    if (collide) addCircle(x, z, 0.75);
  }
  private arch(x: number, z: number, ry: number, span = 4.2, h = 4.2, collide = true, y0?: number) {
    const g = new THREE.Group();
    g.position.set(x, y0 ?? heightAt(x, z), z);
    g.rotation.y = ry;
    this.root.add(g);
    const half = span / 2;
    for (const s of [-1, 1]) for (let yy = 0; yy < h; yy++) this.block(1, 1, 1, s * (half + 0.5), yy, 0, 0, false, g);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * (i + 0.5)) / n;
      const m = this.box(0.98, 0.8, 1, this.stoneTint(i), Math.cos(a) * (half + 0.5), h + Math.sin(a) * (half + 0.5), 0, 0, g);
      m.rotation.z = a - Math.PI / 2;
    }
    this.box(span * 0.55, 0.12, 0.9, C.mossTop, 0, h + half + 0.95, 0, 0, g);
    if (collide) for (const s of [-1, 1]) addCircle(x + Math.cos(ry) * s * (half + 0.5), z - Math.sin(ry) * s * (half + 0.5), 0.75);
    return g;
  }
  private banner(x: number, z: number, ry: number, tall = 4.4, y0?: number) {
    const g = new THREE.Group();
    g.position.set(x, y0 ?? heightAt(x, z), z);
    g.rotation.y = ry;
    this.root.add(g);
    this.cyl(0.09, 0.13, tall, C.wood, 0, tall / 2, 0, 6, g);
    const arm = this.cyl(0.05, 0.05, 1.3, C.wood, 0.55, tall - 0.3, 0, 5, g);
    arm.rotation.z = Math.PI / 2;
    this.bannerTex ??= canvasTex(128, 256, (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(128, 0); ctx.lineTo(128, 206); ctx.lineTo(64, 256); ctx.lineTo(0, 206); ctx.closePath();
      ctx.fillStyle = '#a8432d';
      ctx.fill();
      ctx.strokeStyle = '#e9c873';
      ctx.lineWidth = 6;
      for (const r of [44, 22]) {
        ctx.beginPath();
        ctx.moveTo(64, 104 - r * 1.3); ctx.lineTo(64 + r, 104); ctx.lineTo(64, 104 + r * 1.3); ctx.lineTo(64 - r, 104); ctx.closePath();
        ctx.stroke();
      }
    });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9), new THREE.MeshLambertMaterial({ map: this.bannerTex, side: THREE.DoubleSide, alphaTest: 0.5 }));
    cloth.position.set(0.62, tall - 1.3, 0);
    g.add(cloth);
    this.cloths.push(cloth);
  }
  private glow(x: number, y: number, z: number, size: number, color = 0xffc56a) {
    this.haloTex ??= canvasTex(64, 64, (ctx) => {
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 64, 64);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.userData.size = size;
    this.root.add(s);
    this.glows.push(s);
    return s;
  }
  private lantern(x: number, y: number, z: number) {
    this.box(0.3, 0.06, 0.3, 0x3a2f25, x, y + 0.03, z);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    g.position.set(x, y + 0.21, z);
    this.root.add(g);
    this.box(0.34, 0.07, 0.34, 0x3a2f25, x, y + 0.4, z);
    this.glow(x, y + 0.25, z, 2.6);
  }
  private crate(x: number, z: number, s = 0.8, ry = 0.3) {
    const y = heightAt(x, z);
    this.box(s, s, s, 0x93714a, x, y + s / 2, z, ry);
    this.box(s * 1.04, s * 0.12, s * 1.04, 0x6f5335, x, y + s * 0.94, z, ry);
  }
  private barrel(x: number, z: number) {
    const y = heightAt(x, z);
    this.cyl(0.34, 0.3, 0.85, 0x8a6a45, x, y + 0.43, z, 10);
    this.cyl(0.36, 0.36, 0.07, 0x4a3b2b, x, y + 0.66, z, 10);
    this.cyl(0.345, 0.345, 0.07, 0x4a3b2b, x, y + 0.2, z, 10);
  }
  private waterfall(x: number, yTop: number, yBot: number, z: number, w: number, ry: number) {
    if (!this.fallTex) {
      this.fallTex = canvasTex(64, 256, (ctx) => {
        ctx.fillStyle = 'rgba(190,232,236,0.75)';
        ctx.fillRect(0, 0, 64, 256);
        const r = rng(88);
        for (let i = 0; i < 60; i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
          ctx.fillRect(r() * 64, r() * 256, 1.5 + r() * 3, 20 + r() * 70);
        }
      });
      this.fallTex.wrapT = THREE.RepeatWrapping;
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, yTop - yBot), new THREE.MeshBasicMaterial({ map: this.fallTex, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    m.position.set(x, (yTop + yBot) / 2, z);
    m.rotation.y = ry;
    this.root.add(m);
    const foam = new THREE.Mesh(new THREE.CircleGeometry(w * 0.8, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(x + Math.sin(ry) * 0.5, yBot + 0.05, z + Math.cos(ry) * 0.5);
    this.root.add(foam);
    m.userData.foam = foam;
    return m;
  }
  private fire(x: number, z: number) {
    const y = heightAt(x, z);
    for (const [r, h, c] of [[0.34, 0.9, 0xff8a2a], [0.22, 0.7, 0xffc04a], [0.12, 0.45, 0xfff0b0]] as const) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), new THREE.MeshBasicMaterial({ color: c }));
      f.position.set(x, y + h / 2 + 0.08, z);
      f.userData.h = h;
      this.root.add(f);
      this.flames.push(f);
    }
    this.glow(x, y + 0.6, z, 5, 0xff9a3a);
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x6f8fd6) }, horizon: { value: new THREE.Color(0xf2d6bc) }, sunDir: { value: new THREE.Vector3(38, 30, 24).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = smoothstep(-0.02, 0.6, d.y);
          vec3 c = mix(horizon, top, h); float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.72, 0.42) * (pow(s, 6.0) * 0.28 + pow(s, 90.0) * 0.9);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 14), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
    // far mountains and clouds: flat painted shapes that never fog out
    const rand = rng(404);
    this.farMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true });
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, lo: THREE.Color, hi: THREE.Color, yLo: number, yHi: number) => {
      const ng = g.index ? g.toNonIndexed() : g, p = ng.attributes.position, arr = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        c.lerpColors(lo, hi, Math.min(1, Math.max(0, (p.getY(i) - yLo) / (yHi - yLo))));
        arr.set([c.r, c.g, c.b], i * 3);
      }
      ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      ng.deleteAttribute('uv');
      ng.deleteAttribute('normal');
      return ng;
    };
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * 6.283 + rand() * 0.1, r = 300 + rand() * 110, h = 70 + rand() * 130, w = 70 + rand() * 60;
      const g = new THREE.ConeGeometry(w, h, 7 + Math.floor(rand() * 4), 3);
      g.rotateY(rand() * 3);
      g.translate(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r);
      parts.push(paint(g, new THREE.Color(0x9aa6d2), new THREE.Color(h > 140 ? 0xf3eef4 : 0xb4b6dc), h * 0.52, h * 0.8));
    }
    this.root.add(new THREE.Mesh(mergeGeometries(parts), this.farMat));
    const cl: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rand() * 6.283, r = 380 + rand() * 180, y = 150 + rand() * 110;
      for (let k = 0; k < 4; k++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        g.scale(50 + rand() * 40, 14 + rand() * 12, 34 + rand() * 20);
        g.translate(Math.cos(a) * r + (rand() - 0.5) * 90, y + (rand() - 0.5) * 16, Math.sin(a) * r + (rand() - 0.5) * 90);
        cl.push(paint(g, new THREE.Color(0xf0b9a8), new THREE.Color(0xfff6ea), y - 14, y + 14));
      }
    }
    this.clouds = new THREE.Mesh(mergeGeometries(cl), this.farMat);
    this.root.add(this.clouds);
  }

  private buildFlora() {
    const rand = rng(777);
    const spots: [number, number][] = [];
    for (let i = 0; i < 9000 && spots.length < 3400; i++) {
      const a = rand() * 6.283, r = Math.sqrt(rand()) * 176, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const g = groundAt(x, z);
      if (g === 'grass' || (g === 'needles' && rand() < 0.5)) spots.push([x, z]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const place = (im: THREE.InstancedMesh, i: number, x: number, z: number, s: number, sy = s) => {
      q.setFromAxisAngle(up, rand() * 6.283);
      m4.compose(new THREE.Vector3(x, heightAt(x, z), z), q, new THREE.Vector3(s, sy, s));
      im.setMatrixAt(i, m4);
    };
    const blades = [0, 1, 2].map((k) => {
      const g = new THREE.ConeGeometry(0.07, 0.55, 3);
      g.translate(0, 0.27, 0);
      g.rotateZ((k - 1) * 0.35);
      g.rotateY(k * 2.1);
      return g;
    });
    const tufts = new THREE.InstancedMesh(mergeGeometries(blades), mat(0xffffff), Math.floor(2200 * this.lush));
    for (let i = 0; i < tufts.count; i++) {
      const [x, z] = spots[i % spots.length];
      place(tufts, i, x + rand() - 0.5, z + rand() - 0.5, 0.8 + rand() * 0.9);
      tufts.setColorAt(i, col.setHex([0x7fa648, 0x96b04c, 0xb7b24a, 0x6c9a4a][i & 3]));
    }
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), mat(0xffffff), 420);
    for (let i = 0; i < 420; i++) {
      const [x, z] = spots[(i * 7 + 3) % spots.length];
      place(bushes, i, x, z, 0.6 + rand() * 0.9, 0.45 + rand() * 0.4);
      bushes.setColorAt(i, col.setHex([0x4f8a45, 0x5f9a4a, 0x7da640][i % 3]));
    }
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.floor(1500 * this.lush));
    for (let i = 0; i < flowers.count; i++) {
      const [cx, cz] = spots[(Math.floor(i / 10) * 13 + 5) % spots.length];
      const x = cx + (rand() - 0.5) * 4, z = cz + (rand() - 0.5) * 4;
      q.identity();
      m4.compose(new THREE.Vector3(x, heightAt(x, z) + 0.22 + rand() * 0.2, z), q, new THREE.Vector3(1, 0.7, 1));
      flowers.setMatrixAt(i, m4);
      flowers.setColorAt(i, col.setHex([0xffffff, 0xb48ae6, 0xf4d24e, 0xfdf3d8, 0x9d7be0][Math.floor(i / 10) % 5]));
    }
    for (const im of [tufts, bushes, flowers]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
  }

  private dressZones() {
    const g = (x: number, z: number) => heightAt(x, z);
    // --- Trailhead: banner by the signpost, rune stone, camp gear, ruined arches, gateway over the hidden road
    this.banner(-4.5, 147, 0.4);
    const rune = this.block(1.2, 2, 0.6, 9, g(9, 141) - 0.2, 141, 0.5, true);
    rune.rotation.z = 0.08;
    addCircle(9, 141, 0.8);
    this.crate(-19.5, 124.6);
    this.crate(-20.3, 125.6, 0.6, 0.9);
    this.barrel(-18.6, 123.6);
    this.cyl(0.03, 0.03, 1.5, C.wood, -10.6, g(-10.6, 123) + 0.75, 123, 4);
    this.lantern(-10.6, g(-10.6, 123) + 1.45, 123);
    this.fire(-12.5, 124.5);
    this.arch(-27, 140, 0.9, 3.6, 3.4);
    this.pillar(-23, 144.5, 2.2);
    this.pillar(27, 122, 3.3);
    this.block(3, 1, 1, 29.5, g(29.5, 119), 119, 0.4);
    this.block(2, 1, 1, 29.8, g(29.5, 119) + 1, 119.2, 0.4);
    addCircle(29.5, 119, 1.3);
    this.arch(0, 86, 0, 5, 4.6);
    this.banner(4.6, 84.5, Math.PI);
    // --- Flooded Terraces: aqueduct backdrop with falls, arches on the basin walls, lilies
    for (let i = 0; i < 3; i++) {
      const z = -54 - i * 5.5, h = 3 + i * 2.6;
      this.box(58, h, 5.5, this.stoneTint(i), -122, h / 2, z);
      this.box(57, 0.14, 5.2, C.mossTop, -122, h + 0.05, z);
    }
    for (let i = 0; i < 5; i++) this.arch(-146 + i * 12, -66.5, 0, 4.4, 9.2 + 3, false, 0);
    this.waterfall(-116, 3.05, 0.2, -51.2, 2.4, 0);
    this.waterfall(-116, 5.65, 3.05, -56.7, 2.4, 0);
    this.waterfall(-138, 5.65, 3.05, -56.7, 3, 0);
    this.waterfall(-101, 8.25, 5.65, -62.2, 2.2, 0);
    boxes.push({ x0: -151.5, x1: -92.5, z0: -70, z1: -51.2 });
    for (const x of [-164, -152, -140, -128]) this.arch(x, 9, 0, 3.4, 2.2 + 2.6, false, 0);
    for (const x of [-158, -134]) this.arch(x, 31, 0, 3.4, 2.2 + 2.2, false, 0);
    this.banner(-88.5, 6, Math.PI / 2);
    this.banner(-88.5, -6, Math.PI / 2);
    const lily = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 7), new THREE.MeshLambertMaterial({ color: 0x5f9a46 }), 14);
    const lm = new THREE.Matrix4(), lq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), r2 = rng(61);
    for (let i = 0; i < 14; i++) {
      const a = r2() * 6.283, rr = 0.8 + r2() * 2.2;
      lm.compose(new THREE.Vector3(-100 + Math.cos(a) * rr, 0.085, 22 + Math.sin(a) * rr), lq, new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + r2() * 0.7));
      lily.setMatrixAt(i, lm);
    }
    this.root.add(lily);
    this.lantern(-112.6, 0.7, -31.6);
    for (const [x, z, h] of [[-104, -30, 3.4], [-96, 10, 2.2], [-108, 38, 4], [-130, 40, 2.6], [-140, -5, 3], [-166, -8, 4.2], [-160, -36, 2.4], [-104, 12, 1.4]]) this.pillar(x, z, h, true, 0);
    this.arch(-128, -42, 0, 4, 3.6, true, 0);
    for (const [x, z, ry] of [[-99, -4, 0.3], [-152, -40, 1.1], [-120, 38, 0.2]] as const) {
      this.block(2.4, 0.9, 1, x, 0, z, ry);
      this.block(1.2, 0.8, 1, x + 0.4, 0.9, z, ry + 0.1);
      addCircle(x, z, 1.2);
    }
    // --- Whisper Pines: ruined gate on the way in, lantern and cross at the grave, a mossy log
    this.arch(86, 0, Math.PI / 2, 4.6, 4.2);
    this.pillar(90, 9, 2.4);
    this.pillar(100, -9, 3.6);
    const gy = g(GRAVE.x, GRAVE.z);
    this.lantern(GRAVE.x - 1.1, gy, GRAVE.z + 0.2);
    this.cyl(0.06, 0.07, 1.7, C.wood, GRAVE.x + 1.3, gy + 0.85, GRAVE.z - 0.6, 5);
    this.box(0.9, 0.1, 0.1, C.wood, GRAVE.x + 1.3, gy + 1.3, GRAVE.z - 0.6);
    this.box(0.14, 0.7, 0.05, 0xa8432d, GRAVE.x + 1.55, gy + 0.95, GRAVE.z - 0.55, 0.3);
    const log = this.cyl(0.4, 0.45, 4, 0x6a5a45, 118, g(118, 6) + 0.35, 6, 7);
    log.rotation.set(0, 0.6, Math.PI / 2);
    // --- Shattered Overlook: banner gate at the foot, telescope and broken ring pieces on top
    this.arch(0, -84, 0, 4.4, 4.2);
    this.banner(-4.4, -86, 0);
    const sy = g(MESA.cx, MESA.cz);
    for (let i = 0; i < 3; i++) {
      const leg = this.cyl(0.03, 0.03, 1.5, C.wood, MESA.cx + 3 + Math.cos(i * 2.094) * 0.3, sy + 0.7, MESA.cz + 3 + Math.sin(i * 2.094) * 0.3, 4);
      leg.rotation.set(Math.sin(i * 2.094) * 0.4, 0, Math.cos(i * 2.094) * -0.4);
    }
    const scope = this.cyl(0.07, 0.1, 1.1, C.brass, MESA.cx + 3, sy + 1.5, MESA.cz + 3, 8);
    scope.rotation.set(1.25, 0, 0.3);
    this.banner(MESA.cx - 5.5, MESA.cz + 3, 1.2, 4.4, sy);
    // --- the Vault: the great broken ring, a beam through it, banners at the gate, and the armillary
    const ring = this.add(new THREE.Mesh(new THREE.TorusGeometry(13, 1.4, 6, 40, Math.PI * 1.72), mat(0xcbb893)));
    ring.position.set(0, 11.6, -18.5);
    ring.rotation.z = Math.PI / 2 + Math.PI * 0.14;
    this.block(9, 1.2, 4.5, 0, 0, -18.5, 0, true);
    this.block(30, 1.6, 4, 0, -0.9, -18.5, 0, false);
    for (const x of [-13, 0, 13]) addCircle(x, -18.5, 2.4);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 120, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.4, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.set(0, 70, -18.5);
    this.root.add(beam);
    this.vaultBeam = beam;
    this.banner(-5.2, VAULT.wallR + 1.2, Math.PI, 5);
    this.banner(5.2, VAULT.wallR + 1.2, 0, 5);
    this.armillary = new THREE.Group();
    this.armillary.position.set(0, 4.2, 0);
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * 0.32, 0.05, 6, 40), new THREE.MeshBasicMaterial({ color: [0xffd98a, 0xf4c567, 0xe0a94a][i] }));
      t.rotation.set(i * 1.1, i * 0.7, 0);
      this.armillary.add(t);
    }
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }));
    core.rotation.set(0.6, 0.78, 0);
    this.armillary.add(core);
    this.root.add(this.armillary);
    this.armGlow = this.glow(0, 4.2, 0, 9, 0xffc86a);
    for (let i = 0; i < 12; i += 3) {
      const a = (i / 12) * 6.283 + 0.262;
      this.lantern(Math.cos(a) * 11.6, 0.4, Math.sin(a) * 11.6);
    }
  }

  /** Merge all never-moving boxes and cylinders into one mesh per material (hundreds of draw calls -> a few dozen). */
  private batchStatics() {
    const moving = new Set<THREE.Object3D>([
      this.hurdle, this.locket, this.tableGroup, this.vaultDoor, this.outfall, this.seal, this.armillary,
      ...this.stakeGroups, ...this.chimeTubes, ...Object.values(this.gatePointers), ...Object.values(this.gateWheels),
    ]);
    const isStatic = (o: THREE.Object3D) => {
      for (let n: THREE.Object3D | null = o; n && n !== this.root; n = n.parent) if (moving.has(n)) return false;
      return true;
    };
    this.root.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const m of this.batchable) {
      if (!isStatic(m)) continue;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      g.deleteAttribute('uv');
      const list = groups.get(m.material as THREE.Material) ?? [];
      list.push(g);
      groups.set(m.material as THREE.Material, list);
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const [material, list] of groups) {
      const merged = new THREE.Mesh(mergeGeometries(list), material);
      merged.castShadow = merged.receiveShadow = this.shadows;
      this.root.add(merged);
      for (const g of list) g.dispose();
    }
    this.batchable = [];
  }

  private buildFx(motes: boolean) {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.88, 1, 40),
        new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthTest: false, fog: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      m.renderOrder = 10;
      this.root.add(m);
      this.rings.push({ mesh: m, t: 9 });
    }
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 16, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.3, fog: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      b.visible = false;
      this.root.add(b);
      this.beams.push(b);
    }
    if (motes) {
      const n = 320, pos = new Float32Array(n * 3), rand = rng(5);
      for (let i = 0; i < n * 3; i++) pos[i] = (rand() - 0.5) * 44;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf4efdc, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }));
      this.motes.frustumCulled = false;
      this.root.add(this.motes);
    }
  }

  // ---- state -> visuals -----------------------------------------------------
  /** Make the world match the save. `instant` skips animations (used on load). */
  applyState(s: GameState, instant = false) {
    const solved1 = s.zones[1].complete;
    s.stakes.forEach((st, i) => {
      this.stakeGroups[i].rotation.z = st.found ? 0 : 1.38;
      this.stakeGroups[i].position.y = heightAt(STAKES[i].x, STAKES[i].z) + (st.found ? 0 : 0.08);
      this.stakeVanes[i].rotation.y = (-st.dir * Math.PI) / 4;
      this.threads[i].visible = stakeAligned(s, i);
    });
    this.hurdle.visible = !solved1;
    ringWalls.trailhead.open = solved1;

    const flow = gateFlow(s.gates);
    for (const [name, list] of Object.entries(this.channelWater)) for (const m of list) m.visible = flow.segments.includes(name);
    this.outfall.visible = flow.outfall;
    const dir: Record<string, number> = { A_L: Math.PI, A_R: -Math.PI / 2, B_L: -Math.PI / 2, B_R: Math.PI, C_L: Math.PI, C_R: -Math.PI / 2 };
    for (const id of ['A', 'B', 'C'] as const) this.gatePointers[id].rotation.y = dir[`${id}_${s.gates[id]}`];
    this.target[0] = flow.pool1 ? POOL1.full : POOL1.floor - 0.25;
    this.target[1] = flow.pool2 ? POOL2.full : POOL2.floor - 0.25;
    if (instant) this.level = [...this.target];

    this.activeChime = s.zones[3].complete ? CHIMES.length - 1 : s.chime;
    this.locket.visible = !s.items.locket;
    this.compass.visible = !s.items.compass;

    const unlocked = vaultUnlocked(s);
    ringWalls.vault.open = unlocked;
    this.vaultDoor.visible = !unlocked;
    this.vaultIsOpen = s.vaultOpen;
    props.seal.r = s.vaultOpen ? 1.9 : VAULT.sealR;
    if (instant) this.sealY = s.vaultOpen ? 1 : 0;
    this.dialDiscs.forEach((d, i) => {
      const m = (d.material as THREE.Material[])[1] as THREE.MeshLambertMaterial;
      m.map = this.dialTex[s.dials[i]];
      m.needsUpdate = true;
    });
    this.placedMap.visible = s.ended;
  }

  spinWheel(id: 'A' | 'B' | 'C') {
    this.gateWheels[id].userData.spin = 1;
  }

  waterDepthAt(x: number, z: number): number {
    const pools = [POOL1, POOL2];
    for (let i = 0; i < 2; i++) {
      const p = pools[i];
      if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return this.level[i] - heightAt(x, z);
    }
    return -1;
  }
  /** true once pool 1 has actually finished draining */
  get terraceDry(): boolean {
    return this.level[0] < POOL1.floor + 0.3;
  }
  get basinMoving(): number {
    return Math.sign(this.target[1] - this.level[1]) * (Math.abs(this.target[1] - this.level[1]) > 0.05 ? 1 : 0);
  }

  /** visual twin of the chime sound: a ring of light that grows from the chime */
  ringChime(index: number) {
    const c = CHIMES[index], r = this.rings.reduce((a, b) => (a.t > b.t ? a : b));
    r.t = 0;
    r.mesh.position.set(c.x + (index === CHIMES.length - 1 ? 2.4 : 0.8), heightAt(c.x, c.z) + 2.4, c.z + (index === CHIMES.length - 1 ? -1.4 : 0));
    this.chimeTubes[index].userData.swing = 1;
  }
  chimePosition(index: number): THREE.Vector3 {
    const c = CHIMES[index];
    return new THREE.Vector3(c.x, heightAt(c.x, c.z) + 2.4, c.z);
  }

  setBeams(points: { x: number; z: number }[]) {
    this.beams.forEach((b, i) => {
      const p = points[i];
      b.visible = !!p;
      if (p) b.position.set(p.x, heightAt(p.x, p.z) + 8, p.z);
    });
  }

  update(dt: number, time: number, player: THREE.Vector3, camera: THREE.Camera) {
    // water
    const pools = [POOL1, POOL2];
    for (let i = 0; i < 2; i++) {
      const d = this.target[i] - this.level[i];
      if (Math.abs(d) > 0.001) this.level[i] += Math.sign(d) * Math.min(Math.abs(d), dt * 0.45);
      this.poolMesh[i].position.y = this.level[i] + Math.sin(time * 1.3 + i) * 0.015;
      this.poolMesh[i].visible = this.level[i] > pools[i].floor - 0.1;
    }
    for (const w of Object.values(this.gateWheels)) {
      if (w.userData.spin > 0) {
        w.userData.spin -= dt * 1.2;
        w.rotation.z += dt * 5;
      }
    }
    // seal sinks, table rises
    this.sealY += ((this.vaultIsOpen ? 1 : 0) - this.sealY) * Math.min(1, dt * 0.9);
    this.seal.position.y = 0.65 - this.sealY * 1.28;
    this.seal.scale.setScalar(1);
    this.tableGroup.position.y = -1.6 + this.sealY * 1.6;
    this.tableGroup.visible = this.sealY > 0.02;
    // chimes
    this.chimeTubes.forEach((t, i) => {
      const sw = (t.userData.swing ?? 0) as number;
      if (sw > 0) t.userData.swing = sw - dt * 0.5;
      const amp = (i === this.activeChime ? 0.06 : 0.015) + Math.max(0, sw) * 0.25;
      t.rotation.z = Math.sin(time * 2.3 + i) * amp;
      t.rotation.x = Math.cos(time * 1.7 + i * 2) * amp;
    });
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 2.6;
      r.mesh.visible = k < 1;
      if (k < 1) {
        r.mesh.scale.setScalar(0.6 + k * 9);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
        r.mesh.quaternion.copy(camera.quaternion);
      }
    }
    for (const b of this.beams) if (b.visible) (b.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(time * 2.5) * 0.12;
    if (this.motes) {
      const p = this.motes.geometry.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] += Math.sin(time * 0.3 + i) * dt * 0.25 + dt * 0.3;
        a[i + 1] += Math.cos(time * 0.4 + i) * dt * 0.12;
        // wrap around the player so the cloud follows without popping
        for (const [o, c] of [[0, player.x], [1, player.y + 6], [2, player.z]] as const) {
          if (a[i + o] - c > 22) a[i + o] -= 44;
          else if (a[i + o] - c < -22) a[i + o] += 44;
        }
      }
      p.needsUpdate = true;
    }
    // dressing: cloth, flames, lantern glow, falling water, the armillary
    this.cloths.forEach((c, i) => (c.rotation.x = Math.sin(time * 1.4 + i * 1.7) * 0.07));
    this.flames.forEach((f, i) => f.scale.set(1 + Math.sin(time * 9 + i) * 0.12, 1 + Math.sin(time * 13 + i * 2) * 0.22, 1));
    this.glows.forEach((gl, i) => gl.scale.setScalar(gl.userData.size * (1 + Math.sin(time * 7 + i * 3) * 0.06)));
    if (this.fallTex) this.fallTex.offset.y = (time * 0.9) % 1;
    this.armillary.visible = this.armGlow.visible = this.sealY > 0.5;
    this.armillary.children.forEach((r, i) => { r.rotation.x += dt * (0.25 + i * 0.12); r.rotation.y += dt * (0.2 - i * 0.07); });
    this.armillary.position.y = 3.2 + this.sealY * 1.2 + Math.sin(time * 0.8) * 0.12;
    this.armGlow.position.y = this.armillary.position.y;
    (this.vaultBeam.material as THREE.MeshBasicMaterial).opacity = (this.vaultIsOpen ? 0.6 : 0.28) + Math.sin(time * 1.1) * 0.06;
    this.sky.position.copy(camera.position);
    this.clouds.rotation.y = time * 0.002;
    // atmosphere eases toward whichever zone the player is in
    const zone = zoneAt(player.x, player.z);
    this.atmosZone = zone;
    const at = ATMOS[zone];
    const k = Math.min(1, dt * 0.7);
    this.skyNow.lerp(new THREE.Color(at.sky), k);
    this.fogNow += (at.fog - this.fogNow) * k;
    (this.scene.background as THREE.Color).copy(this.skyNow);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.skyNow);
    fog.density = this.fogNow * (1 - this.clearAir) + 0.0018 * this.clearAir;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const thick = Math.min(1, Math.max(0, (fog.density - 0.008) / 0.024));
    (u.horizon.value as THREE.Color).copy(this.skyNow);
    (u.top.value as THREE.Color).lerp(new THREE.Color(at.top).lerp(this.skyNow, thick), k);
    this.farMat.opacity = 1 - thick;
  }

  get zone(): ZoneId | 0 {
    return this.atmosZone as ZoneId | 0;
  }
  zoneCentre(z: ZoneId) {
    return ZONES[z];
  }
}

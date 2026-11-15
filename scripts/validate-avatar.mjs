#!/usr/bin/env node
// Checks a character .glb before it is swapped in (see src/config.ts).
// usage: node scripts/validate-avatar.mjs public/avatar/cartographer.glb
import { readFileSync, statSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/validate-avatar.mjs <file.glb>'); process.exit(2); }
const LIMITS = { sizeMb: 4, triangles: 25000, textureMax: 2048, heightMin: 1.4, heightMax: 2.1 };
const REQUIRED = ['Idle', 'Walk', 'Run', 'Interact'];
const buf = readFileSync(file);
const problems = [], notes = [];
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('FAIL  not a binary glTF (.glb) file'); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

const sizeMb = statSync(file).size / 1048576;
if (sizeMb > LIMITS.sizeMb) problems.push(`file is ${sizeMb.toFixed(1)} MB (limit ${LIMITS.sizeMb} MB): lower texture size or decimate`);

const clips = (gltf.animations ?? []).map((a) => a.name ?? '');
for (const want of REQUIRED) if (!clips.some((c) => c.toLowerCase() === want.toLowerCase())) problems.push(`clip "${want}" missing (found: ${clips.join(', ') || 'none'}): name the action exactly "${want}" and push it to an NLA track before export`);

if (!(gltf.skins ?? []).length) problems.push('no skin/armature found: export with the armature selected and "Skinning" enabled');
else notes.push(`${gltf.skins[0].joints.length} bones`);

let tris = 0, minY = Infinity, maxY = -Infinity;
for (const mesh of gltf.meshes ?? []) for (const prim of mesh.primitives) {
  const pos = gltf.accessors[prim.attributes.POSITION];
  const count = prim.indices !== undefined ? gltf.accessors[prim.indices].count : pos.count;
  tris += count / 3;
  if (pos.min && pos.max) { minY = Math.min(minY, pos.min[1]); maxY = Math.max(maxY, pos.max[1]); }
}
if (tris > LIMITS.triangles) problems.push(`${Math.round(tris)} triangles (limit ${LIMITS.triangles}): add a Decimate modifier`);
const height = maxY - minY;
if (isFinite(height)) {
  if (height > LIMITS.heightMax * 20) problems.push(`mesh is ${height.toFixed(1)} units tall, looks like a 100x scale problem: in Blender apply scale (Ctrl+A > Scale) and export in metres`);
  else if (height < LIMITS.heightMin || height > LIMITS.heightMax) problems.push(`mesh is ${height.toFixed(2)} m tall, expected ${LIMITS.heightMin}-${LIMITS.heightMax} m: scale the character or set AVATAR.scale in src/config.ts`);
  if (Math.abs(minY) > 0.08) problems.push(`feet are at y=${minY.toFixed(2)}, expected 0: move the origin to the ground between the feet`);
}
for (const node of gltf.nodes ?? []) if (node.scale && node.scale.some((v) => Math.abs(v - 1) > 0.01) && (node.mesh !== undefined || node.skin !== undefined)) problems.push(`node "${node.name}" has unapplied scale ${JSON.stringify(node.scale)}: apply scale before export`);
(gltf.images ?? []).forEach((img, i) => notes.push(`image ${i}: ${img.mimeType ?? img.uri ?? 'embedded'}`));

console.log(`${file}: ${sizeMb.toFixed(2)} MB, ${Math.round(tris)} triangles, height ${isFinite(height) ? height.toFixed(2) + ' m' : 'unknown'}, clips [${clips.join(', ')}]${notes.length ? ', ' + notes.join(', ') : ''}`);
if (problems.length) { for (const p of problems) console.log('FAIL  ' + p); process.exit(1); }
console.log('PASS  avatar is ready: set AVATAR.url in src/config.ts');

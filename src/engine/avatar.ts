// The player character. Ships with a procedural placeholder figure; if
// AVATAR.url is set (see src/config.ts) a rigged GLB with Idle/Walk/Run/Interact
// clips is loaded instead, and the placeholder is only a fallback.
import * as THREE from 'three';
import { AVATAR } from '../config';

export interface AvatarPose {
  speed: number; // horizontal m/s
  running: boolean;
  interacting: boolean;
  climbing: boolean;
}

export interface Avatar {
  root: THREE.Group;
  update(dt: number, pose: AvatarPose): void;
}

function m(color: number) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function createPlaceholderAvatar(shadows: boolean): Avatar {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(geo, m(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    parent.add(mesh);
    return mesh;
  };
  const limb = (x: number, y: number, w: number, len: number, color: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    body.add(pivot);
    add(new THREE.BoxGeometry(w, len, w * 1.1), color, 0, -len / 2, 0, pivot);
    return pivot;
  };
  // Placeholder built to the character sheet: olive hooded jacket, cream shirt,
  // brown trousers and boots, satchel on the hip, map tube across the back.
  const SKIN = 0xe0b48e, JACKET = 0x66713d, TROUSER = 0x6a4c36, BOOT = 0x4d3524, LEATHER = 0x8a5a34;
  const legL = limb(-0.11, 0.8, 0.17, 0.8, TROUSER), legR = limb(0.11, 0.8, 0.17, 0.8, TROUSER);
  for (const leg of [legL, legR]) {
    add(new THREE.BoxGeometry(0.2, 0.34, 0.24), BOOT, 0, -0.64, 0.01, leg);
    add(new THREE.BoxGeometry(0.19, 0.16, 0.05), 0xb89a6a, 0, -0.34, 0.1, leg); // knee patch
  }
  add(new THREE.CylinderGeometry(0.21, 0.27, 0.72, 8), JACKET, 0, 1.15, 0);
  add(new THREE.BoxGeometry(0.14, 0.5, 0.05), 0xeadcbc, 0, 1.22, 0.21); // shirt
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), LEATHER, 0, 0.84, 0); // belt
  const hood = add(new THREE.IcosahedronGeometry(0.2, 1), JACKET, 0, 1.5, -0.12);
  hood.scale.set(1.1, 0.7, 0.9);
  const armL = limb(-0.3, 1.46, 0.12, 0.34, JACKET), armR = limb(0.3, 1.46, 0.12, 0.34, JACKET);
  for (const arm of [armL, armR]) {
    add(new THREE.BoxGeometry(0.14, 0.07, 0.15), 0xd8c9a4, 0, -0.34, 0, arm); // rolled cuff
    add(new THREE.BoxGeometry(0.1, 0.28, 0.1), SKIN, 0, -0.5, 0, arm);
  }
  add(new THREE.IcosahedronGeometry(0.18, 1), SKIN, 0, 1.7, 0);
  const hair = add(new THREE.IcosahedronGeometry(0.21, 1), 0x2b211c, 0, 1.76, -0.03);
  hair.scale.set(1.05, 0.8, 1.05);
  for (const [x, y, z] of [[0.1, 1.9, 0.05], [-0.09, 1.91, -0.02], [0.02, 1.92, -0.1], [-0.14, 1.84, 0.08], [0.15, 1.83, -0.06]])
    add(new THREE.ConeGeometry(0.07, 0.14, 4), 0x2b211c, x, y, z).rotation.set(z * 4, 0, -x * 4);
  add(new THREE.BoxGeometry(0.13, 0.3, 0.36), LEATHER, -0.31, 0.95, 0.02); // satchel
  add(new THREE.BoxGeometry(0.14, 0.1, 0.38), 0x6f4526, -0.31, 1.08, 0.02);
  const strap = add(new THREE.BoxGeometry(0.05, 0.78, 0.03), LEATHER, 0.0, 1.22, 0.215);
  strap.rotation.z = -0.72;
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), 0xdcae4c, 0.2, 0.82, 0.2).rotation.x = Math.PI / 2; // compass
  const tube = add(new THREE.CylinderGeometry(0.065, 0.065, 0.78, 8), 0xe8dcc0, 0.02, 1.3, -0.26);
  tube.rotation.z = 0.85;
  for (const e of [-1, 1]) {
    const cap = add(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 8), LEATHER, 0.02 - e * 0.26, 1.3 + e * 0.23, -0.26);
    cap.rotation.z = 0.85;
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  root.add(shadow);

  let phase = 0, reach = 0, t = 0;
  return {
    root,
    update(dt, pose) {
      t += dt;
      const moving = pose.speed > 0.3;
      phase += dt * (pose.running ? 11 : 7.5) * (moving ? 1 : 0);
      const amp = moving ? (pose.running ? 0.95 : 0.6) : 0;
      const sw = Math.sin(phase) * amp;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      reach += ((pose.interacting ? 1 : 0) - reach) * Math.min(1, dt * 10);
      if (pose.climbing) {
        armL.rotation.x = -2.6 + Math.sin(t * 7) * 0.4;
        armR.rotation.x = -2.6 - Math.sin(t * 7) * 0.4;
        legL.rotation.x = Math.sin(t * 7) * 0.5;
        legR.rotation.x = -Math.sin(t * 7) * 0.5;
      } else {
        armL.rotation.x = -sw * 0.8;
        armR.rotation.x = sw * 0.8 * (1 - reach) - 1.3 * reach;
      }
      body.position.y = moving ? Math.abs(Math.cos(phase)) * 0.05 : Math.sin(t * 1.6) * 0.012;
      body.rotation.x = pose.running && moving ? 0.12 : 0;
    },
  };
}

/** Load the owner's GLB. Rejects with a readable reason if it is missing required clips. */
export async function loadGlbAvatar(shadows: boolean): Promise<Avatar> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(AVATAR.url);
  const find = (name: string) => gltf.animations.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const clips = { idle: find(AVATAR.clips.idle), walk: find(AVATAR.clips.walk), run: find(AVATAR.clips.run), interact: find(AVATAR.clips.interact) };
  const missing = Object.entries(clips).filter(([, c]) => !c).map(([k]) => AVATAR.clips[k as keyof typeof AVATAR.clips]);
  if (missing.length) throw new Error(`avatar is missing animation clip(s): ${missing.join(', ')}`);
  const root = new THREE.Group();
  gltf.scene.scale.setScalar(AVATAR.scale);
  gltf.scene.rotation.y = AVATAR.yawOffset;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = shadows;
      o.frustumCulled = false;
    }
  });
  root.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = {
    idle: mixer.clipAction(clips.idle!),
    walk: mixer.clipAction(clips.walk!),
    run: mixer.clipAction(clips.run!),
    interact: mixer.clipAction(clips.interact!),
  };
  let current: keyof typeof actions = 'idle';
  actions.idle.play();
  return {
    root,
    update(dt, pose) {
      const want: keyof typeof actions = pose.interacting ? 'interact' : pose.speed > 0.3 ? (pose.running ? 'run' : 'walk') : 'idle';
      if (want !== current) {
        actions[want].reset().fadeIn(0.2).play();
        actions[current].fadeOut(0.2);
        current = want;
      }
      mixer.update(dt);
    },
  };
}

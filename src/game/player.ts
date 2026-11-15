// Kinematic character controller and the third-person camera.
import * as THREE from 'three';
import { heightAt, resolve } from '../world/terrain';
import { TUNING } from '../config';
import type { Avatar } from '../engine/avatar';

const STEP_UP = 0.5; // highest rise the character will walk up within PROBE metres
const PROBE = 0.4;
const WADE = 0.7; // deepest water that can be walked into

export class Player {
  pos = new THREE.Vector3();
  yaw = Math.PI;
  speed = 0;
  running = false;
  interactT = 0;
  private vy = 0;
  private climb: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done?: () => void } | null = null;

  constructor(public avatar: Avatar) {}

  get climbing() {
    return this.climb !== null;
  }

  place(x: number, z: number, yaw = this.yaw, y?: number) {
    this.pos.set(x, y ?? heightAt(x, z), z);
    this.yaw = yaw;
    this.vy = 0;
    this.climb = null;
  }

  climbTo(x: number, z: number, done?: () => void) {
    const to = new THREE.Vector3(x, heightAt(x, z), z);
    this.yaw = Math.atan2(to.x - this.pos.x, to.z - this.pos.z);
    this.climb = { from: this.pos.clone(), to, t: 0, dur: 1.5, done };
  }

  update(dt: number, move: { x: number; y: number }, run: boolean, camYaw: number, waterDepth: (x: number, z: number) => number) {
    if (this.interactT > 0) this.interactT -= dt;
    if (this.climb) {
      const c = this.climb;
      c.t += dt / c.dur;
      const k = Math.min(1, c.t);
      // up first, then over the lip
      const up = Math.min(1, k / 0.7), over = Math.max(0, (k - 0.55) / 0.45);
      this.pos.x = c.from.x + (c.to.x - c.from.x) * over;
      this.pos.z = c.from.z + (c.to.z - c.from.z) * over;
      this.pos.y = c.from.y + (c.to.y - c.from.y) * (up * up * (3 - 2 * up));
      this.speed = 0;
      if (k >= 1) {
        this.climb = null;
        this.pos.copy(c.to);
        c.done?.();
      }
      this.sync(dt);
      return;
    }

    const mag = Math.min(1, Math.hypot(move.x, move.y));
    this.running = run && mag > 0.1;
    const target = mag * (this.running ? TUNING.runSpeed : TUNING.walkSpeed);
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.05) {
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const dx = (fx * move.y - fz * move.x) / mag, dz = (fz * move.y + fx * move.x) / mag;
      const want = Math.atan2(dx, dz);
      let d = want - this.yaw;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.yaw += d * Math.min(1, dt * 12);
      const step = this.speed * dt;
      const prev = { x: this.pos.x, z: this.pos.z };
      const nx = this.pos.x + dx * step, nz = this.pos.z + dz * step;
      // slide along whatever blocks the full move
      if (this.canGo(nx, nz, dx, dz, waterDepth)) {
        this.pos.x = nx;
        this.pos.z = nz;
      } else if (Math.abs(dx) > 0.05 && this.canGo(nx, this.pos.z, Math.sign(dx), 0, waterDepth)) {
        this.pos.x = nx;
      } else if (Math.abs(dz) > 0.05 && this.canGo(this.pos.x, nz, 0, Math.sign(dz), waterDepth)) {
        this.pos.z = nz;
      } else {
        this.speed *= 0.5;
      }
      resolve(this.pos, prev, TUNING.playerRadius);
    }
    // gravity and ground following
    const ground = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y > ground + 0.05) {
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vy = 0;
      }
    } else {
      this.vy = 0;
      this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 20);
    }
    this.sync(dt);
  }

  private canGo(x: number, z: number, dx: number, dz: number, waterDepth: (x: number, z: number) => number): boolean {
    const here = this.pos.y;
    const airborne = here > heightAt(this.pos.x, this.pos.z) + 0.3;
    const ahead = heightAt(x + dx * PROBE, z + dz * PROBE);
    if (airborne) {
      if (heightAt(x, z) > here + 0.2) return false;
    } else if (ahead - here > STEP_UP || heightAt(x, z) - here > STEP_UP) {
      return false;
    }
    // never wade in over your depth (but never trap someone already in the water)
    if (waterDepth(x, z) > WADE && waterDepth(this.pos.x, this.pos.z) <= WADE) return false;
    return true;
  }

  private sync(dt: number) {
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.update(dt, { speed: this.speed, running: this.running, interacting: this.interactT > 0, climbing: this.climbing });
  }
}

export interface Shot {
  to: THREE.Vector3;
  look: THREE.Vector3;
  dur: number;
  hold: number;
}

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.3;
  private dist = TUNING.cameraDistance;
  private target = new THREE.Vector3();
  private shot: (Shot & { t: number; from: THREE.Vector3; fromLook: THREE.Vector3; done: () => void }) | null = null;
  private started = false;

  constructor(public camera: THREE.PerspectiveCamera) {}

  get inShot() {
    return this.shot !== null;
  }
  /** 0..1 progress of the current scripted shot (0 when there is none) */
  get shotAmount() {
    if (!this.shot) return 0;
    const s = this.shot;
    return Math.min(1, Math.min(s.t / (s.dur * 0.5), (s.dur + s.hold - s.t) / 1.5));
  }

  /** aspect-aware FOV: keep at least ~78 degrees horizontally on narrow screens */
  resize(w: number, h: number) {
    const aspect = w / h;
    const wantH = (78 * Math.PI) / 180;
    const v = (2 * Math.atan(Math.tan(wantH / 2) / aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(80, Math.max(52, v));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  snap() {
    this.started = false;
  }

  play(shot: Shot, done: () => void) {
    this.shot = { ...shot, t: 0, from: this.camera.position.clone(), fromLook: this.target.clone(), done };
  }

  update(dt: number, player: THREE.Vector3, look: { dx: number; dy: number }, sensitivity: number, invertY: boolean, reducedMotion: boolean) {
    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      // reduced motion: cut straight to the end frame instead of flying there
      const raw = reducedMotion ? 1 : Math.min(1, s.t / s.dur);
      const k = raw * raw * (3 - 2 * raw);
      this.camera.position.lerpVectors(s.from, s.to, k);
      this.camera.lookAt(new THREE.Vector3().lerpVectors(s.fromLook, s.look, k));
      if (s.t >= s.dur + s.hold) {
        this.shot = null;
        this.started = false;
        s.done();
      }
      return;
    }
    const sens = 0.0023 * sensitivity;
    this.yaw -= look.dx * sens;
    this.pitch += look.dy * sens * (invertY ? -1 : 1);
    this.pitch = Math.min(1.25, Math.max(-0.3, this.pitch));

    const want = new THREE.Vector3(player.x, player.y + 1.55, player.z);
    if (!this.started) this.target.copy(want);
    else this.target.lerp(want, Math.min(1, dt * (reducedMotion ? 30 : 12)));

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // pull the camera in if the ground would hide the character
    let allowed = TUNING.cameraDistance;
    for (let i = 1; i <= 10; i++) {
      const d = (i / 10) * TUNING.cameraDistance;
      const x = this.target.x - fx * cp * d, z = this.target.z - fz * cp * d, y = this.target.y + sp * d;
      if (heightAt(x, z) + 0.35 > y) {
        allowed = Math.max(1.2, d - TUNING.cameraDistance / 10);
        break;
      }
    }
    if (!this.started) this.dist = allowed;
    else this.dist += (allowed - this.dist) * Math.min(1, dt * (allowed < this.dist ? 14 : 3));
    this.started = true;
    const cx = this.target.x - fx * cp * this.dist, cz = this.target.z - fz * cp * this.dist;
    const cy = Math.max(this.target.y + sp * this.dist, heightAt(cx, cz) + 0.3);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
  }
}

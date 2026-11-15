// The conductor: turns input into rule changes (core/logic), then tells the
// world, UI, audio and save what happened.
import * as THREE from 'three';
import {
  newState, stakeInteract, stakesSolved, gateTurn, gateFlow, chimeReached, holdBears, vaultUnlocked, dialTurn,
  discover, evaluateAchievements, stakeAligned, GLYPHS, GLYPH_NAMES, type GameState, type Glyph,
} from '../core/logic';
import { save, safeStorage, SAVE_KEY } from '../core/save';
import { Bus } from '../core/events';
import {
  DISCOVERY_POINTS, STAKES, GATES, CHIMES, CHIME_REACH, LOCKET, MESA, HOLDS, VAULT, SPAWN, ZONES, zoneAt,
  type DiscoveryPoint, type ZoneId,
} from '../world/layout';
import { heightAt } from '../world/terrain';
import { World } from '../world/world';
import { Player, CameraRig } from './player';
import { Input } from '../engine/input';
import { GameAudio } from '../engine/audio';
import { UI, type UiHost } from '../ui/ui';
import { story, text } from '../content';
import { TUNING } from '../config';
import type { Avatar } from '../engine/avatar';

interface Interactable {
  id: string;
  x: number;
  z: number;
  r?: number;
  /** null = not available right now */
  label: () => string | null;
  act: () => void;
}

const HOLD_STAND = 2.5, HOLD_LAND = 2.7;
const holdPoint = (tier: number, deg: number, offset: number) => {
  const a = (deg * Math.PI) / 180, r = MESA.radii[tier] + offset;
  return { x: MESA.cx + Math.cos(a) * r, z: MESA.cz + Math.sin(a) * r };
};

export class Game implements UiHost {
  state: GameState;
  hasSave: boolean;
  readonly bus = new Bus();
  readonly ui: UI;
  readonly player: Player;
  readonly rig: CameraRig;
  readonly audio = new GameAudio();
  time = 0;
  running = false;
  private interactables: Interactable[] = [];
  private current: Interactable | null = null;
  private zone: ZoneId | 0 = 0;
  private zoneTime: Record<number, number> = {};
  private hintsShown = new Set<string>();
  private chimeTimer = 1;
  private scanTimer = 0;
  private saveTimer = 0;
  private storage = safeStorage();
  private tut = { step: -1, moved: 0, looked: 0, t: 0 };
  private poolDir = 0;

  constructor(
    public world: World,
    camera: THREE.PerspectiveCamera,
    public input: Input,
    avatar: Avatar,
    loaded: { state: GameState; status: 'new' | 'loaded' | 'corrupt' },
  ) {
    this.state = loaded.state;
    this.hasSave = loaded.status === 'loaded' && loaded.state.started;
    this.player = new Player(avatar);
    this.rig = new CameraRig(camera);
    this.ui = new UI(this, input);
    this.buildInteractables();
    input.onTrigger = (t) => this.trigger(t);
    input.onFirstGesture = () => this.audio.unlock();
    this.audio.setVolume(this.state.settings.volume);
    this.player.place(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.world.applyState(this.state, true);
    this.ui.showTitle(loaded.status === 'corrupt' ? story.ui.corruptSave : undefined);
  }

  // ---- UiHost ---------------------------------------------------------------
  playerMarker() {
    return this.running ? { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw } : null;
  }
  hints(): string[] {
    return [...this.hintsShown].map((k) => story.hints[k as keyof typeof story.hints]);
  }
  begin(fresh: boolean) {
    this.audio.unlock();
    if (fresh || !this.hasSave) {
      const settings = this.state.settings;
      this.state = newState();
      this.state.settings = settings;
      this.tut.step = 0;
    }
    this.state.started = true;
    const p = this.state.pos;
    if (p && this.world.waterDepthAt(p.x, p.z) < 0.7) {
      this.player.place(p.x, p.z, p.yaw, Math.max(p.y, heightAt(p.x, p.z)));
      this.rig.yaw = p.yaw;
    } else {
      this.player.place(SPAWN.x, SPAWN.z, SPAWN.yaw);
      this.rig.yaw = SPAWN.yaw;
    }
    this.rig.snap();
    this.world.applyState(this.state, true);
    this.running = true;
    this.zone = 0;
    this.ui.hudVisible(true);
    this.ui.setExplored();
    this.ui.close();
    this.persist();
  }
  resetProgress() {
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch { /* ignore */ }
    location.reload();
  }
  settingsChanged(reload = false) {
    const s = this.state.settings;
    this.audio.setVolume(s.volume);
    this.input.setBindings(s.keys);
    this.persist();
    if (reload) location.reload();
  }

  // ---- helpers --------------------------------------------------------------
  persist() {
    if (this.running) {
      const p = this.player.pos;
      this.state.pos = { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw };
    }
    save(this.storage, this.state);
  }
  private changed() {
    this.world.applyState(this.state);
    for (const id of evaluateAchievements(this.state)) {
      const a = story.achievements[id as keyof typeof story.achievements];
      this.ui.toast('ach', a.title, a.desc);
      this.audio.sfx('achievement');
      this.bus.emit('achievement', { id });
    }
    this.ui.setExplored();
    this.persist();
    this.bus.emit('state:changed');
  }
  private found(d: DiscoveryPoint) {
    if (!discover(this.state, d.id)) return;
    this.ui.toast('map', `${story.ui.charted}: ${d.label}`);
    this.audio.sfx('found');
    this.bus.emit('dp:found', { id: d.id, label: d.label });
    if (this.tut.step === 3) this.tut.step = 4;
    this.changed();
  }
  private markRead(id: string) {
    if (!this.state.read.includes(id)) this.state.read.push(id);
  }
  private addSymbol(g: Glyph) {
    if (this.state.symbols.includes(g)) return;
    this.state.symbols.push(g);
    this.ui.toast('note', 'Mark copied to journal', GLYPH_NAMES[g]);
  }
  completeZone(z: ZoneId) {
    if (this.state.zones[z].complete) return;
    this.state.zones[z].complete = true;
    this.state.zones[z].visited = true;
    this.ui.toast('map', 'Map updated', story.zones[String(z) as '1'].name);
    this.audio.sfx('success');
    this.bus.emit('zone:complete', { zone: z });
    this.changed();
    if (vaultUnlocked(this.state) && z !== 5) this.ui.toast('note', story.objectives.vaultOpen);
  }
  private readStory(id: string, done?: () => void) {
    this.markRead(id);
    this.audio.sfx('page');
    this.player.interactT = 0.6;
    this.ui.read(id, done);
  }

  // ---- interactables --------------------------------------------------------
  private buildInteractables() {
    const I = story.interact;
    const s = () => this.state;
    for (const d of DISCOVERY_POINTS) {
      const base: Interactable = { id: d.id, x: d.x, z: d.z, label: () => `${I.read}: ${d.label}`, act: () => { this.found(d); this.readStory(d.textId); } };
      switch (d.id) {
        case 'DP-Z2-02':
          base.r = 3.4;
          base.label = () => (this.world.terraceDry ? `${I.read}: carvings` : null);
          base.act = () => { this.found(d); this.readStory(d.textId, () => { this.addSymbol('wave'); this.completeZone(2); }); };
          break;
        case 'DP-Z3-02':
          base.label = () => `${I.read}: the marker`;
          base.act = () => { this.found(d); this.readStory(d.textId, () => { this.addSymbol('fork'); this.completeZone(3); }); };
          break;
        case 'DP-Z4-02':
          base.label = () => (this.player.pos.y > MESA.step * 3.5 ? I.survey : null);
          base.act = () => { this.found(d); this.summit(); };
          break;
        case 'DP-Z5-02':
          base.label = () => (s().vaultOpen ? `${I.read}: field book` : null);
          break;
        case 'DP-Z5-03':
          base.r = 4;
          break;
      }
      this.interactables.push(base);
    }
    STAKES.forEach((st, i) => this.interactables.push({
      id: `stake${i}`, x: st.x, z: st.z,
      label: () => (s().zones[1].complete ? null : s().stakes[i].found ? I.stakeTurn : I.stakeRight),
      act: () => {
        const r = stakeInteract(s(), i);
        this.player.interactT = 0.5;
        this.audio.sfx(r === 'righted' ? 'stone' : 'turn');
        if (stakeAligned(s(), i)) { this.audio.sfx('tick'); this.ui.caption(story.captions.click); }
        if (this.tut.step === 3) this.tut.step = 4;
        this.changed();
        if (stakesSolved(s())) { this.completeZone(1); this.readStory('z1.solved'); }
      },
    }));
    for (const id of ['A', 'B', 'C'] as const) this.interactables.push({
      id: `gate${id}`, x: GATES[id].x, z: GATES[id].z,
      label: () => I.gateTurn,
      act: () => {
        const before = gateFlow(s().gates);
        gateTurn(s(), id);
        const after = gateFlow(s().gates);
        this.player.interactT = 0.6;
        this.world.spinWheel(id);
        this.audio.sfx('stone');
        this.ui.caption(story.captions.gate);
        if (before.pool2 !== after.pool2 || before.pool1 !== after.pool1) {
          const filling = (after.pool2 && !before.pool2) || (after.pool1 && !before.pool1);
          setTimeout(() => this.ui.caption(filling ? story.captions.flood : story.captions.drain), 1600);
        }
        this.changed();
      },
    });
    HOLDS.forEach((tier, t) => tier.forEach((h, i) => {
      const stand = holdPoint(t, h.deg, HOLD_STAND), land = holdPoint(t, h.deg, -HOLD_LAND);
      this.interactables.push({
        id: `hold${t}_${i}`, x: stand.x, z: stand.z, r: 2.2,
        label: () => (Math.abs(this.player.pos.y - t * MESA.step) < 1.6 && !this.player.climbing ? `${I.climb} (${GLYPH_NAMES[h.glyph]})` : null),
        act: () => {
          if (holdBears(t, i)) {
            this.audio.sfx('turn');
            this.player.climbTo(land.x, land.z);
          } else {
            this.audio.sfx('crumble');
            this.ui.caption(story.captions.crumble);
            this.ui.toast('note', text('z4.crumble').body);
            this.player.interactT = 0.5;
          }
        },
      });
    }));
    this.interactables.push({
      id: 'locket', x: LOCKET.x, z: LOCKET.z, r: 2,
      label: () => (s().items.locket || !s().zones[3].complete ? null : `${I.take}: something under the stone`),
      act: () => { s().items.locket = true; this.readStory(s().items.compass ? 'z3.locketLate' : 'z3.locket'); this.changed(); },
    });
    this.interactables.push({
      id: 'compass', x: VAULT.compass.x, z: VAULT.compass.z, r: 2.2,
      label: () => (s().vaultOpen && !s().items.compass ? `${I.take}: brass compass` : null),
      act: () => { s().items.compass = true; this.readStory(s().items.locket ? 'z5.compass' : 'z5.compassAlone'); this.changed(); },
    });
    VAULT.dials.forEach((d, i) => this.interactables.push({
      id: `dial${i}`, x: d.x, z: d.z, r: 2.4,
      label: () => (vaultUnlocked(s()) && !s().vaultOpen ? `${I.dialTurn}: ${i === 0 ? 'WHAT THE WATER KEPT' : 'WHAT THE PINES KEPT'} (${GLYPH_NAMES[GLYPHS[s().dials[i]]]})` : null),
      act: () => {
        const opened = dialTurn(s(), i as 0 | 1);
        this.player.interactT = 0.5;
        this.audio.sfx('turn');
        this.changed();
        if (opened) {
          this.audio.sfx('seal');
          this.ui.caption(story.captions.seal);
          this.readStory('z5.opened');
        }
      },
    }));
    this.interactables.push({
      id: 'table', x: -0.8, z: 2.3, r: 2.4,
      label: () => (s().vaultOpen && !s().ended ? (s().read.includes('z5.log') ? story.interact.placeMap : null) : null),
      act: () => {
        s().ended = true;
        this.changed();
        this.readStory('z5.ending', () => { this.completeZone(5); this.readStory('credits'); });
      },
    });
  }

  private summit() {
    const reduced = this.state.settings.reducedMotion;
    this.input.enabled = false;
    this.ui.setPrompt(null);
    const finish = () => {
      this.ui.fade(false);
      this.readStory('z4.summit', () => this.completeZone(4));
    };
    const shot = { to: new THREE.Vector3(0, 300, -175), look: new THREE.Vector3(0, 0, 0), dur: reduced ? 0.01 : 7, hold: reduced ? 5 : 3.5 };
    if (reduced) {
      this.ui.fade(true);
      setTimeout(() => { this.rig.play(shot, () => { this.ui.fade(true); setTimeout(finish, 700); }); this.ui.fade(false); }, 700);
    } else {
      this.rig.play(shot, finish);
    }
  }

  private trigger(t: 'interact' | 'map' | 'pause') {
    if (!this.running) return;
    if (t === 'pause') {
      if (this.ui.modal === null) { if (!this.rig.inShot) this.ui.open('pause'); }
      else if (this.ui.modal === 'reader') (document.querySelector('[data-act="closeReader"]') as HTMLElement).click();
      else if (this.ui.modal !== 'title' && this.ui.modal !== 'error') this.ui.close();
      return;
    }
    if (t === 'map') {
      if (this.ui.modal === 'map') this.ui.close();
      else if (this.ui.modal === null && !this.rig.inShot) { this.ui.open('map'); if (this.tut.step === 4) this.tut.step = 5; }
      return;
    }
    if (this.ui.modal === 'reader') return void (document.querySelector('[data-act="closeReader"]') as HTMLElement).click();
    if (this.ui.modal === null && this.current && !this.player.climbing && !this.rig.inShot) this.current.act();
  }
  /** used by the debug hook and tests */
  interact(id: string): boolean {
    const it = this.interactables.find((i) => i.id === id);
    if (!it || it.label() === null) return false;
    it.act();
    return true;
  }

  // ---- per-frame ------------------------------------------------------------
  update(dt: number) {
    this.ui.update(dt);
    if (!this.running) {
      // title screen: slow drift over the trailhead
      this.time += dt;
      this.rig.yaw = Math.PI + Math.sin(this.time * 0.05) * 0.5;
      this.rig.update(dt, this.player.pos, { dx: 0, dy: 0 }, 1, false, false);
      this.world.update(dt, this.time, this.player.pos, this.rig.camera);
      return;
    }
    const paused = this.ui.modal !== null;
    this.input.poll();
    const st = this.state.settings;
    const look = this.input.takeLook();
    if (paused) return;
    this.time += dt;
    this.state.playTime += dt;
    const p = this.player;
    const cine = this.rig.inShot;
    p.update(dt, cine ? { x: 0, y: 0 } : this.input.move, this.input.run, this.rig.yaw, (x, z) => this.world.waterDepthAt(x, z));
    this.rig.update(dt, p.pos, cine ? { dx: 0, dy: 0 } : look, st.sensitivity, st.invertY, st.reducedMotion);
    if (!cine && !this.input.enabled && this.ui.modal === null) this.input.enabled = true;
    this.world.clearAir = this.rig.shotAmount;
    this.world.update(dt, this.time, p.pos, this.rig.camera);
    this.audio.footsteps(dt, p.speed, p.running);

    // zone tracking
    const zone = zoneAt(p.pos.x, p.pos.z);
    if (zone !== this.zone) {
      this.zone = zone;
      this.ui.setZone(story.zones[String(zone) as '1'].name);
      this.bus.emit('zone:enter', { zone });
      if (zone && !this.state.zones[zone].visited) {
        this.state.zones[zone].visited = true;
        this.changed();
      }
    }
    this.ui.setObjective(this.objective());
    const dWater = Math.hypot(p.pos.x - ZONES[2].cx, p.pos.z - ZONES[2].cz);
    this.audio.ambience(zone, Math.max(0, 1 - dWater / 60), this.time);
    const fwd = new THREE.Vector3();
    this.rig.camera.getWorldDirection(fwd);
    this.audio.listener(this.rig.camera.position, fwd);

    // nearest available interactable, and walk-past discoveries (5 Hz is plenty)
    if ((this.scanTimer -= dt) <= 0) {
      this.scanTimer = 0.2;
      let best: Interactable | null = null, bestD = 1e9;
      for (const it of this.interactables) {
        const d = Math.hypot(it.x - p.pos.x, it.z - p.pos.z);
        if (d < (it.r ?? TUNING.interactRange) && d < bestD && Math.abs(heightAt(it.x, it.z) - p.pos.y) < 2.6 && it.label() !== null) {
          best = it;
          bestD = d;
        }
      }
      this.current = cine || p.climbing ? null : best;
      this.ui.setPrompt(this.current ? this.current.label() : null);
      for (const d of DISCOVERY_POINTS) {
        if (d.interactOnly || this.state.dps.includes(d.id)) continue;
        if (Math.hypot(d.x - p.pos.x, d.z - p.pos.z) < TUNING.discoverRange && Math.abs(heightAt(d.x, d.z) - p.pos.y) < 3) this.found(d);
      }
      this.updateHints();
    }
    this.updateChimes(dt);
    this.updateTutorial(dt, look);
    // tell the player when the long basin finishes moving
    const dir = this.world.basinMoving;
    if (dir === 0 && this.poolDir !== 0) this.audio.sfx('tick');
    this.poolDir = dir;

    if ((this.saveTimer += dt) > 6) {
      this.saveTimer = 0;
      this.persist();
    }
  }

  private objective(): string {
    const s = this.state, z = this.zone;
    if (s.ended) return story.objectives.done;
    const nearVault = Math.hypot(this.player.pos.x, this.player.pos.z) < 34;
    if (nearVault && s.zones[1].complete && !vaultUnlocked(s)) return story.objectives.vaultLocked;
    if (z === 5 && s.vaultOpen) return story.objectives.finish;
    if (z && !s.zones[z].complete) return story.zones[String(z) as '1'].objective;
    if (!s.zones[1].complete) return story.zones['1'].objective;
    if (vaultUnlocked(s)) return story.objectives.vaultOpen;
    return story.zones['0'].objective;
  }

  private updateHints() {
    const z = this.zone;
    const beams: { x: number; z: number }[] = [];
    if (z && !this.state.zones[z].complete && !(z === 5 && !vaultUnlocked(this.state))) {
      const tsec = (this.zoneTime[z] = (this.zoneTime[z] ?? 0) + 0.2);
      for (const [key, at] of [[`z${z}.a`, TUNING.hintA], [`z${z}.b`, TUNING.hintB]] as const) {
        if (tsec > at && !this.hintsShown.has(key)) {
          this.hintsShown.add(key);
          this.ui.toast('note', 'A thought, in your journal', 'Pause, then open the journal');
        }
      }
      if (tsec > TUNING.hintB) {
        const s = this.state;
        if (z === 1) STAKES.forEach((st, i) => { if (!stakeAligned(s, i)) beams.push(st); });
        if (z === 2) {
          const next = s.gates.C === 'L' ? 'C' : s.gates.B === 'L' ? 'B' : s.gates.A === 'L' ? 'A' : null;
          if (next) beams.push(GATES[next]);
        }
        if (z === 3) beams.push(CHIMES[s.chime]);
        if (z === 4) {
          const tier = Math.min(3, Math.max(0, Math.round(this.player.pos.y / MESA.step)));
          const h = HOLDS[tier].find((_, i) => holdBears(tier, i))!;
          beams.push(holdPoint(tier, h.deg, HOLD_STAND));
        }
      }
    } else {
      // finished zones drop their hints
      for (const k of [...this.hintsShown]) if (this.state.zones[Number(k[1]) as ZoneId].complete) this.hintsShown.delete(k);
    }
    this.world.setBeams(beams);
  }

  private updateChimes(dt: number) {
    const s = this.state, p = this.player.pos, last = CHIMES.length - 1;
    const done = s.zones[3].complete;
    const idx = done ? last : s.chime;
    const c = CHIMES[idx];
    const dist = Math.hypot(c.x - p.x, c.z - p.z);
    if (!done && dist < CHIME_REACH && chimeReached(s, idx, last)) {
      this.audio.sfx('found');
      this.ui.caption(story.captions.chimeNear);
      this.chimeTimer = 1.2;
      this.changed();
      return;
    }
    const near = dist < (done ? 30 : 80) && (this.zone === 3 || dist < 45);
    // direction readout: the visual twin of the positional sound
    if (near && !done) {
      const dx = c.x - p.x, dz = c.z - p.z, y = this.rig.yaw;
      const ang = Math.atan2(dx * -Math.cos(y) + dz * Math.sin(y), dx * Math.sin(y) + dz * Math.cos(y));
      this.ui.soundDirection(ang, `${story.captions.chime} · ${Math.round(dist)} m`);
    } else {
      this.ui.soundDirection(null);
    }
    if (!near) return;
    if ((this.chimeTimer -= dt) <= 0) {
      this.chimeTimer = done ? 7 : 3.4;
      this.audio.chime(this.world.chimePosition(idx), idx);
      this.world.ringChime(idx);
      if (!done) {
        this.ui.caption(story.captions.chime);
        const dx = c.x - p.x, dz = c.z - p.z, y = this.rig.yaw;
        this.ui.soundDirection(Math.atan2(dx * -Math.cos(y) + dz * Math.sin(y), dx * Math.sin(y) + dz * Math.cos(y)), `${story.captions.chime} · ${Math.round(dist)} m`, true);
      }
    }
  }

  private updateTutorial(dt: number, look: { dx: number; dy: number }) {
    const tu = this.tut, u = story.ui, touch = this.input.isTouch;
    if (tu.step < 0 || tu.step > 5) return;
    tu.t += dt;
    tu.moved += this.player.speed * dt;
    tu.looked += Math.abs(look.dx) + Math.abs(look.dy);
    let tip: string | null = null;
    if (tu.step === 0) { tip = touch ? u.tutMoveTouch : u.tutMove; if (tu.moved > 3) { tu.step = 1; tu.looked = 0; tu.t = 0; } }
    else if (tu.step === 1) { tip = touch ? u.tutLookTouch : u.tutLook; if (tu.looked > 250 || tu.t > 14) { tu.step = 2; tu.t = 0; } }
    else if (tu.step === 2) { tip = touch ? u.tutRunTouch : u.tutRun; if (this.player.running || tu.t > 9) tu.step = 3; }
    else if (tu.step === 4) { tip = touch ? u.tutMapTouch : u.tutMap; tu.t = 0; }
    else if (tu.step === 5) tu.step = 6;
    this.ui.setTip(tip);
  }
}

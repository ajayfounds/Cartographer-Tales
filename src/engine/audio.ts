// All sound is synthesised with Web Audio: no audio files, nothing to license.
// The context starts suspended and is unlocked on the first key press or tap.
import * as THREE from 'three';

type Sfx = 'tick' | 'turn' | 'stone' | 'found' | 'success' | 'achievement' | 'crumble' | 'page' | 'seal';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private water!: { gain: GainNode };
  private volume = 0.8;
  private stepTimer = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // one looping noise buffer feeds both the wind bed and the water bed
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.04; // soft, brownish noise
      d[i] = last * 6;
    }
    const bed = (type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return { gain, filter };
    };
    this.wind = bed('lowpass', 500);
    this.water = bed('bandpass', 1500);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }
  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }

  /** ambient bed per zone; `waterNear` 0..1 brings up running water */
  ambience(zone: number, waterNear: number, time: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = [0.2, 0.16, 0.14, 0.32, 0.4, 0.1][zone] ?? 0.2;
    const freq = [520, 480, 600, 340, 800, 260][zone] ?? 500;
    const gust = 0.75 + Math.sin(time * 0.37) * 0.15 + Math.sin(time * 0.91) * 0.1;
    this.wind.gain.gain.setTargetAtTime(base * gust, t, 0.6);
    this.wind.filter.frequency.setTargetAtTime(freq, t, 1.2);
    this.water.gain.gain.setTargetAtTime(0.22 * waterNear, t, 0.5);
  }

  listener(pos: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', dest?: AudioNode, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private burst(dur: number, gain: number, freq: number, q = 1) {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /** positional wind chime: three struck brass partials from a point in the world */
  chime(pos: THREE.Vector3, seed: number) {
    if (!this.ctx) return;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 6;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    const scale = [1046.5, 1174.7, 1318.5, 1568, 1760];
    for (let i = 0; i < 3; i++) {
      const f = scale[(seed + i * 2) % 5];
      this.tone(f, 2.4, 0.3, 'sine', p, i * 0.19);
      this.tone(f * 2.76, 0.9, 0.07, 'sine', p, i * 0.19);
    }
    setTimeout(() => p.disconnect(), 4000);
  }

  sfx(name: Sfx) {
    if (!this.ctx) return;
    switch (name) {
      case 'tick': this.tone(880, 0.08, 0.12, 'triangle'); break;
      case 'turn': this.burst(0.18, 0.5, 900, 2); this.tone(196, 0.15, 0.1, 'triangle'); break;
      case 'stone': this.burst(0.7, 0.9, 220, 1.5); break;
      case 'page': this.burst(0.22, 0.25, 3200, 0.7); break;
      case 'crumble': this.burst(0.5, 0.8, 500, 0.8); this.burst(0.3, 0.5, 1400, 1); break;
      case 'found': this.tone(659, 0.5, 0.14); this.tone(988, 0.7, 0.12, 'sine', undefined, 0.12); break;
      case 'success': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.4, 0.13, 'sine', undefined, i * 0.14)); break;
      case 'achievement': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 1.0, 0.1, 'triangle', undefined, i * 0.09)); break;
      case 'seal': this.burst(2.2, 1, 90, 0.8); this.tone(55, 2.4, 0.3, 'sine'); break;
    }
  }

  footsteps(dt: number, speed: number, running: boolean) {
    if (!this.ctx || speed < 0.5) return;
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = running ? 0.29 : 0.42;
      this.burst(0.09, 0.16, 300 + Math.random() * 200, 0.9);
    }
  }
}

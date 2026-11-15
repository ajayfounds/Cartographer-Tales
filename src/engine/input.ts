// One input surface for the game, fed by keyboard + mouse or by touch.
// Game code only reads `move`, `run`, `takeLook()` and the action callbacks.
import type { Action, Settings } from '../core/logic';

export type Trigger = 'interact' | 'map' | 'pause';

export class Input {
  move = { x: 0, y: 0 };
  run = false;
  /** false while a menu is open: movement reads as zero and look is ignored */
  enabled = false;
  isTouch = false;
  stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  onTrigger: (t: Trigger) => void = () => {};
  onFirstGesture: () => void = () => {};
  onStickChange: () => void = () => {};

  private keys = new Set<string>();
  private look = { dx: 0, dy: 0 };
  private bindings: Record<Action, string>;
  private capture: ((code: string) => void) | null = null;
  private stickId = -1;
  private lookId = -1;
  private lastTouch = { x: 0, y: 0 };
  private dragging = false;
  private gestured = false;

  constructor(private canvas: HTMLCanvasElement, settings: Settings) {
    this.bindings = settings.keys;
    this.isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointerUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setBindings(keys: Record<Action, string>) {
    this.bindings = keys;
  }
  /** next key press is handed to `fn` instead of the game (used by key remapping) */
  captureNextKey(fn: (code: string) => void) {
    this.capture = fn;
  }
  takeLook() {
    const l = { ...this.look };
    this.look.dx = this.look.dy = 0;
    return l;
  }
  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** call once per frame before reading move/run */
  poll() {
    if (!this.enabled) {
      this.move.x = this.move.y = 0;
      this.run = false;
      return;
    }
    if (this.stick.active) {
      this.move.x = this.stick.x;
      this.move.y = this.stick.y;
      this.run = Math.hypot(this.stick.x, this.stick.y) > 0.92;
      return;
    }
    const b = this.bindings, k = this.keys;
    const x = (k.has(b.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(b.left) || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has(b.forward) || k.has('ArrowUp') ? 1 : 0) - (k.has(b.back) || k.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    this.move.x = x / len;
    this.move.y = y / len;
    this.run = k.has(b.run) || (b.run === 'ShiftLeft' && k.has('ShiftRight'));
  }

  private gesture() {
    if (!this.gestured) {
      this.gestured = true;
      this.onFirstGesture();
    }
  }

  private keyDown(e: KeyboardEvent) {
    this.gesture();
    if (this.capture) {
      e.preventDefault();
      const fn = this.capture;
      this.capture = null;
      if (e.code !== 'Escape') fn(e.code);
      return;
    }
    if (e.code === 'Escape') return this.onTrigger('pause');
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.keys.add(e.code);
    if (e.code === this.bindings.interact) this.onTrigger('interact');
    else if (e.code === this.bindings.map) this.onTrigger('map');
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }

  private pointerDown(e: PointerEvent) {
    this.gesture();
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.dragging = true;
      // pointer lock gives free mouse-look; if the browser refuses, dragging still works
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
      return;
    }
    this.isTouch = true;
    if (e.clientX < window.innerWidth * 0.42 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.stick = { active: true, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.onStickChange();
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lastTouch = { x: e.clientX, y: e.clientY };
    }
  }

  private pointerMove(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement === this.canvas || this.dragging) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
      return;
    }
    if (e.pointerId === this.stickId) {
      const R = 56;
      let dx = (e.clientX - this.stick.ox) / R, dy = (e.clientY - this.stick.oy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.stick.x = dx;
      this.stick.y = -dy;
      this.onStickChange();
    } else if (e.pointerId === this.lookId) {
      this.look.dx += (e.clientX - this.lastTouch.x) * 2.2;
      this.look.dy += (e.clientY - this.lastTouch.y) * 2.2;
      this.lastTouch = { x: e.clientX, y: e.clientY };
    }
  }

  private pointerUp(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.dragging = false;
      return;
    }
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      this.onStickChange();
    }
    if (e.pointerId === this.lookId) this.lookId = -1;
  }
}

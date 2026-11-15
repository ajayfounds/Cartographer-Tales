// Debug / test hook. Only present in dev builds or when built with VITE_DEBUG=1;
// the import in main.ts is behind the DEBUG constant so production drops it.
import type * as THREE from 'three';
import type { Game } from './game/game';
import type { ZoneId } from './world/layout';

export function installDebug(game: Game, renderer: THREE.WebGLRenderer) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:4px 8px;background:rgba(0,0,0,.6);color:#9f9;font:11px monospace;z-index:20;pointer-events:none';
  if (new URLSearchParams(location.search).has('perf')) document.body.appendChild(box);
  const frames: number[] = [];
  const api = {
    game,
    state: () => JSON.parse(JSON.stringify(game.state)),
    pos: () => ({ x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z }),
    teleport: (x: number, z: number, yaw?: number) => { game.player.place(x, z, yaw ?? game.player.yaw); game.rig.yaw = yaw ?? game.rig.yaw; game.rig.snap(); },
    look: (yaw: number, pitch = 0.3) => { game.rig.yaw = yaw; game.rig.pitch = pitch; game.rig.snap(); },
    interact: (id: string) => game.interact(id),
    completeZone: (z: ZoneId) => game.completeZone(z),
    closeReader: () => (document.querySelector('[data-act="closeReader"]') as HTMLElement | null)?.click(),
    modal: () => game.ui.modal,
    /** advance the simulation without waiting for real frames (deterministic tests) */
    step: (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 30); i++) game.update(1 / 30); },
    frame(ms: number) {
      frames.push(ms);
      if (frames.length > 600) frames.shift();
    },
    perf() {
      const sorted = [...frames].sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
      return { frames: frames.length, avgMs: +avg.toFixed(2), p99Ms: +(sorted[Math.floor(sorted.length * 0.99)] ?? 0).toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
  };
  (window as unknown as { __cart: typeof api }).__cart = api;
  setInterval(() => {
    const p = api.perf();
    box.textContent = `${(1000 / (p.avgMs || 16)).toFixed(0)} fps  ${p.avgMs} ms (p99 ${p.p99Ms})\n${p.calls} calls  ${p.tris} tris`;
  }, 500);
  return api;
}

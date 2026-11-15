import * as THREE from 'three';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './style.css';
import { load, safeStorage } from './core/save';
import { pickTier, tierSettings, detectDevice } from './engine/quality';
import { Input } from './engine/input';
import { createPlaceholderAvatar, loadGlbAvatar, type Avatar } from './engine/avatar';
import { World } from './world/world';
import { Game } from './game/game';
import { AVATAR } from './config';
import { story } from './content';

const canvas = document.getElementById('game') as HTMLCanvasElement;

function fatal(message: string) {
  const ui = document.getElementById('ui')!;
  ui.innerHTML = `<div class="screen"><div class="paper reader"><h2>${story.title.name}</h2><div class="body"><p>${message}</p></div></div></div>`;
}

async function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return fatal(story.ui.noWebgl);

  const loaded = load(safeStorage());
  const settings = loaded.state.settings;
  if (loaded.status !== 'loaded' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settings.reducedMotion = true;
  const tier = tierSettings(pickTier(settings.quality, detectDevice()), window.devicePixelRatio || 1);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, powerPreference: 'high-performance' });
  } catch {
    return fatal(story.ui.noWebgl);
  }
  renderer.setPixelRatio(tier.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 900);
  scene.add(new THREE.HemisphereLight(0xd4defc, 0x8f9a5c, 1.75));
  const sun = new THREE.DirectionalLight(0xffdca8, 2.7);
  sun.castShadow = tier.shadows;
  if (tier.shadows) {
    sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    const c = sun.shadow.camera;
    c.left = c.bottom = -42;
    c.right = c.top = 42;
    c.near = 1;
    c.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
  }
  scene.add(sun, sun.target);

  const world = new World(scene, { shadows: tier.shadows, motes: tier.motes });
  let avatar: Avatar = createPlaceholderAvatar(tier.shadows);
  if (AVATAR.url) {
    try {
      avatar = await loadGlbAvatar(tier.shadows);
    } catch (err) {
      console.warn('[avatar] using the placeholder:', err);
    }
  }
  scene.add(avatar.root);

  const input = new Input(canvas, settings);
  const game = new Game(world, camera, input, avatar, loaded);
  // literal env checks so the production bundle drops the debug hook entirely
  const debug = import.meta.env.DEV || import.meta.env.VITE_DEBUG === '1' ? (await import('./debug')).installDebug(game, renderer) : null;

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    game.rig.resize(w, h);
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  // pause when the tab or app goes to the background, and come back cleanly
  let hidden = false;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) {
      game.persist();
      game.audio.suspend();
    } else {
      game.audio.resume();
      last = performance.now();
    }
  });
  window.addEventListener('pagehide', () => game.persist());

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    game.persist();
    game.ui.showError(story.ui.contextLost, true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (game.ui.modal === 'error') game.running ? game.ui.close() : game.ui.showTitle();
  });

  const rotateMq = window.matchMedia('(orientation: portrait) and (max-width: 600px) and (pointer: coarse)');
  let last = performance.now();
  const sunOffset = new THREE.Vector3(48, 40, 30);
  renderer.setAnimationLoop((now) => {
    const raw = now - last;
    last = now;
    if (hidden || lost || rotateMq.matches) return;
    const dt = Math.min(0.05, raw / 1000);
    game.update(dt);
    sun.target.position.copy(game.player.pos);
    sun.position.copy(game.player.pos).add(sunOffset);
    renderer.render(scene, camera);
    debug?.frame(raw);
  });
}

void boot();

// One place to swap the placeholder character for the real avatar.
//
// To use your own character: export it from Blender as GLB, run
//   node scripts/validate-avatar.mjs public/avatar/cartographer.glb
// and when it passes, set `url` below to '/avatar/cartographer.glb'.
// Leave url empty to keep the built-in placeholder figure.
export const AVATAR = {
  url: '',
  /** uniform scale applied to the loaded model (1 = authored in metres, 1.7 m tall) */
  scale: 1,
  /** radians to add if the model does not face +Z in Blender's glTF export */
  yawOffset: 0,
  /** animation clip names expected in the GLB (case-insensitive) */
  clips: { idle: 'Idle', walk: 'Walk', run: 'Run', interact: 'Interact' },
};

export const TUNING = {
  walkSpeed: 4.2,
  runSpeed: 7.6,
  playerRadius: 0.4,
  cameraDistance: 6.5,
  interactRange: 2.7,
  discoverRange: 5,
  hintA: 100, // seconds in an unfinished zone before the first journal hint
  hintB: 240, // ...before the second hint and the light beams
};


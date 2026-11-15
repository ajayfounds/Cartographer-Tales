# The Cartographer

A short third-person exploration game that runs in the browser on laptops and phones.
You map the Hollow Reach in your mentor's place: five zones, five puzzles, a hand-drawn map that fills in as you explore.

Built with Three.js + Vite + TypeScript. No backend; progress is saved in `localStorage`.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit tests for puzzles, exploration rule, achievements, saves
pnpm build      # production build in dist/
```

Deploy: import the repo in Vercel (framework preset "Vite"). `vercel.json` already sets the build command and cache headers.

## Controls

| | Keyboard + mouse | Touch |
|---|---|---|
| Move | W A S D (remappable) | drag on the left side |
| Run | hold Shift | push the stick fully |
| Look | click the view, move the mouse | drag on the right side |
| Interact | E | gold button, bottom right |
| Map | M | Map button |
| Pause | Esc | II button |

## Where things live

| Path | What |
|---|---|
| `src/content/story.json` | every line of story, hint, achievement and UI copy; rename the cast under `"cast"` |
| `src/world/layout.ts` | positions of zones, landmarks and puzzle pieces |
| `src/core/logic.ts` | puzzle rules, the "explored" rule, achievement rules (unit-tested) |
| `src/core/save.ts` | versioned save with migrations |
| `src/world/world.ts` | all scenery (generated in code) and the visual side of each puzzle |
| `src/game/` | controller, camera, and the game conductor |
| `src/ui/` | HTML overlays and the SVG map |
| `src/config.ts` | avatar swap and tuning numbers |
| `public/art/key-art.jpg` | title-screen art (cropped from the owner's promotional sheet) |

## Swapping in your own character

The player is a placeholder figure built to the character sheet. To replace it:

1. Export your rigged character from Blender as `public/avatar/cartographer.glb` with four actions named `Idle`, `Walk`, `Run`, `Interact`, facing +Y in Blender (the glTF exporter turns that into +Z), 1.7 m tall, origin between the feet.
2. `node scripts/validate-avatar.mjs public/avatar/cartographer.glb` and fix whatever it reports.
3. Set `AVATAR.url = '/avatar/cartographer.glb'` in `src/config.ts`.

## Debug hook

In `pnpm dev` (or a build made with `VITE_DEBUG=1`) `window.__cart` exposes `state()`, `teleport(x, z)`, `interact(id)`, `completeZone(n)`, `step(seconds)` and `perf()`. Add `?perf` to the URL for an fps / draw-call overlay. `scripts/playthrough.mjs` uses it to play all five zones headlessly.

## The five zones

1. **The Trailhead** — right the three survey stakes and turn each vane to sight on the cairn.
2. **The Flooded Terraces** — three sluice wheels each send the water one of two ways; get it to the outfall.
3. **The Whisper Pines** — follow the one chime that is ringing (sound, plus rings of light and an on-screen arrow).
4. **The Shattered Overlook** — the route slab lists the mark to trust on each tier.
5. **The Vault** — opens once 1-4 are mapped; set the two dials to the marks from the terrace and the grave.

"100% explored" = all 19 landmarks charted and all five zones complete.

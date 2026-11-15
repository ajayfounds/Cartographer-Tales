// screenshots of key views for visual review: node scripts/views.mjs [w h touch]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [w = '1280', h = '720', touch = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch === '1', isMobile: touch === '1' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForTimeout(3000);
await page.screenshot({ path: `shots/v-${w}-title.png` });
await page.evaluate(() => document.querySelector('[data-act="new"]').click());
await page.waitForTimeout(500);
const views = { trailhead: [0, 150, Math.PI, 0.22], camp: [-9, 131, Math.PI * 1.25, 0.25], gateway: [1, 101, Math.PI, 0.2], terraces: [-96, -8, -Math.PI / 2 - 0.5, 0.3], basin: [-118, 20, -Math.PI / 2, 0.45], pines: [96, 2, Math.PI / 2, 0.15], grave: [148, 31, Math.PI, 0.25], overlook: [0, -78, Math.PI, 0.05], summit: [0, -121, 0, 0.35], vaultgate: [0, 40, Math.PI, 0.1], vault: [0, 16, Math.PI, 0.12], ringroad: [50, 50, Math.PI * 1.25, 0.2] };
const only = process.argv[5]?.split(',');
for (const [name, [x, z, yaw, pitch]] of Object.entries(views)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([x, z, yaw, pitch, name]) => { const c = window.__cart; if (name === 'vault' || name === 'vaultgate') { for (const k of [1,2,3,4]) c.game.state.zones[k].complete = true; if (name === 'vault') c.game.state.vaultOpen = true; c.game.world.applyState(c.game.state, true); } c.teleport(x, z, yaw); c.look(yaw, pitch); c.step(name === 'summit' ? 0.2 : 3); }, [x, z, yaw, pitch, name]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/v-${w}-${name}.png` });
}
console.log('errors', JSON.stringify(errors));
await browser.close();

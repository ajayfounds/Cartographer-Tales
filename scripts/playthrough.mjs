// Scripted golden path through all five zones using the debug hook.
// usage: node scripts/playthrough.mjs [width height touch]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [w = '1280', h = '720', touch = '0'] = process.argv.slice(2);
const tag = `${w}x${h}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch === '1', isMobile: touch === '1' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const st = () => ev(() => window.__cart.state());
const tp = (x, z, yaw) => ev(([x, z, yaw]) => window.__cart.teleport(x, z, yaw), [x, z, yaw]);
const act = (id) => ev((id) => window.__cart.interact(id), id);
const close = async () => { for (let i = 0; i < 4; i++) { if ((await ev(() => window.__cart.modal())) !== 'reader') break; await ev(() => window.__cart.closeReader()); await page.waitForTimeout(120); } };
const shot = (n) => page.screenshot({ path: `shots/${tag}-${n}.png` });
const real = (ms) => page.waitForTimeout(ms);
const wait = async (ms) => { await ev((s) => window.__cart.step(s), ms / 1000); await page.waitForTimeout(250); };

await page.goto('http://127.0.0.1:5173/');
await real(2500);
await shot('00-title');
await (touch === '1' ? page.tap('[data-act="new"]') : page.click('[data-act="new"]'));
await real(800);
ok((await st()).started, 'game starts');

// --- real input: walk forward, and the hurdle must hold
const p0 = await ev(() => window.__cart.pos());
if (touch === '1') {
  const cdp = await ctx.newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(150, +h - 120) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(150, +h - 190) });
  await wait(1500); await shot('01-touch-walk');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
} else {
  await page.keyboard.down('KeyW'); await wait(1500); await page.keyboard.up('KeyW');
}
const p1 = await ev(() => window.__cart.pos());
ok(p0.z - p1.z > 2, `walking north with ${touch === '1' ? 'virtual stick' : 'W'} moved ${(p0.z - p1.z).toFixed(1)} m`);
await shot('01-trailhead');
await tp(0, 99, Math.PI);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(2500); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
ok((await ev(() => window.__cart.pos())).z > 92.5, 'hurdle blocks the gap before the puzzle is solved');

// --- zone 1
await tp(-14, 128.5, Math.PI); await wait(500);
ok((await st()).dps.includes('DP-Z1-02'), 'campsite discovered by walking up to it');
await act('DP-Z1-02'); await wait(300); await shot('02-letter'); await close();
const targets = [1, 7, 0];
for (let i = 0; i < 3; i++) {
  await act(`stake${i}`);
  for (let k = 0; k < 8 && (await st()).stakes[i].dir !== targets[i]; k++) await act(`stake${i}`);
}
await wait(300); await close();
let s = await st();
ok(s.zones[1].complete && s.achievements.includes('first_lines'), 'zone 1 complete + First Lines');
await tp(0, 110, Math.PI); await wait(600); await shot('03-z1-solved');
await tp(3, 99, Math.PI);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(2500); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
ok((await ev(() => window.__cart.pos())).z < 90, 'gap is open after the puzzle');

// --- zone 2
await tp(-112, -30, Math.PI / 2 * 3); await wait(700); await shot('04-terraces');
ok(!(await act('DP-Z2-02')), 'carvings unreachable while flooded');
await tp(-124, -20, -Math.PI / 2);
await page.keyboard.down('KeyW'); await wait(2500); await page.keyboard.up('KeyW');
const wet = await ev(() => window.__cart.pos());
ok(wet.x > -127.5, `flooded pool stops the player at x=${wet.x.toFixed(1)}`);
await act('gateA'); await wait(6500);
await tp(-121, 20, -Math.PI / 2);
await page.keyboard.down('KeyW'); await wait(2500); await page.keyboard.up('KeyW');
ok((await ev(() => window.__cart.pos())).x > -127, 'turning A first floods the long basin and blocks the crossing');
await act('gateA'); await wait(6500);
await tp(-121, 20, -Math.PI / 2);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(5000); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
const far = await ev(() => window.__cart.pos());
ok(far.x < -150, `dry basin can be crossed on foot (x=${far.x.toFixed(1)})`);
await tp(-156, 19, 0); await wait(300);
ok(await act('gateC'), 'wheel C turned'); 
await tp(-114, 6, 0); await wait(300); await act('gateB'); await tp(-114, -33, 0); await wait(300); await act('gateA');
await wait(9000);
await tp(-143, -20, -Math.PI / 2); await wait(700); await shot('05-carvings');
ok(await act('DP-Z2-02'), 'carvings readable once drained'); await wait(200); await close();
s = await st();
ok(s.zones[2].complete && s.symbols.includes('wave') && s.achievements.includes('drained_charted'), 'zone 2 complete + wave mark + Drained and Charted');

// --- zone 3
await tp(84, 2, Math.PI / 2); await wait(4200); await shot('06-pines');
const chimes = [[92, 4], [106, -16], [124, -22], [138, -6], [132, 14]];
for (const [x, z] of chimes) { await tp(x + 2, z + 2); await wait(500); }
ok((await st()).chime === 5, 'all five chimes followed in order');
await tp(148, 29, Math.PI); await wait(3800); await shot('07-grave');
await act('DP-Z3-02'); await wait(200); await close();
ok(await act('locket'), 'locket half found at the grave'); await close();
s = await st();
ok(s.zones[3].complete && s.symbols.includes('fork') && s.achievements.includes('followed_sound'), 'zone 3 complete + dividers mark + Followed the Sound');

// --- zone 4
await tp(0, -88, Math.PI); await wait(600); await shot('08-overlook');
await act('DP-Z4-01'); await close();
const holds = [[30, 58, 1], [22, 112, 2], [15, 84, 0], [9, 100, 1]];
const wrong = await ev(() => { const g = window.__cart; g.teleport(0 + Math.cos(Math.PI / 2) * 32.5, -125 + Math.sin(Math.PI / 2) * 32.5); return 1; });
await wait(300); await act('hold0_0'); await wait(300);
ok((await ev(() => window.__cart.pos())).y < 1, 'a wrong hold does not lift the player');
for (let t = 0; t < 4; t++) {
  const [R, deg, idx] = holds[t], a = deg * Math.PI / 180;
  await tp(Math.cos(a) * (R + 2.5), -125 + Math.sin(a) * (R + 2.5)); await wait(250);
  if (t === 1) await shot('09-hold');
  ok(await act(`hold${t}_${idx}`), `tier ${t + 1} marked hold accepted`);
  await wait(1900);
}
const top = await ev(() => window.__cart.pos());
ok(top.y > 15, `summit reached (y=${top.y.toFixed(1)})`);
await tp(1.5, -124, Math.PI); await wait(400); await shot('10-summit');
await act('DP-Z4-02'); await wait(8500); await shot('11-reveal'); await wait(3000); await close();
s = await st();
ok(s.zones[4].complete && s.achievements.includes('view_above'), 'zone 4 complete + The View From Above');

// --- zone 5
await tp(0, 34, Math.PI); await wait(700); await shot('12-vault-gate');
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(2200); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
ok((await ev(() => window.__cart.pos())).z < 22, 'vault gate is open once zones 1-4 are done');
await tp(0, 10.5, Math.PI); await wait(500); await shot('13-dials');
for (let k = 0; k < 6 && (await st()).dials[0] !== 1; k++) await act('dial0');
for (let k = 0; k < 6 && !(await st()).vaultOpen; k++) await act('dial1');
await wait(300); await close();
ok((await st()).vaultOpen, 'vault opens on wave + dividers');
await wait(5000);
await tp(2.6, 2.4, Math.PI * 1.25); await wait(500); await shot('14-table');
ok(!(await act('table')), 'map cannot be placed before reading the log');
await act('DP-Z5-02'); await close();
ok(await act('compass'), 'compass found'); await close();
ok(await act('table'), 'map placed'); await wait(300); await shot('15-ending'); await close(); await wait(300); await close();
s = await st();
ok(s.zones[5].complete && s.ended && s.achievements.includes('map_complete') && s.achievements.includes('old_partners'), 'ending + The Map Complete + Old Partners');

// map + remaining landmarks
await page.keyboard.press('KeyM'); await wait(400); await shot('16-map'); await page.keyboard.press('KeyM');
for (const [x, z] of [[5, 146], [24, 133], [0, 100], [-116, -40], [-100, 26], [-98, -13], [110, 26], [146, -19], [-35, -109], [4.5, 30], [-14, -14]]) { await tp(x, z); await wait(350); }
await ev(() => { const g = window.__cart; g.teleport(-17.4, -131.3); }); await wait(100);
// rope cache sits on tier 2: climb state is not needed, teleport lands on the ledge
await wait(400);
s = await st();
ok(s.dps.length === 19, `all 19 landmarks charted (${s.dps.length})`);
ok(s.achievements.length === 7, `all 7 achievements (${s.achievements.join(',')})`);
await page.keyboard.press('KeyM'); await wait(400); await shot('17-map-100');
ok((await page.textContent('.m-pct')).startsWith('100%'), 'map reads 100% explored');
await page.keyboard.press('KeyM');
// reload keeps everything
await page.reload(); await real(2500);
await (touch === '1' ? page.tap('[data-act="continue"]') : page.click('[data-act="continue"]')); await wait(600);
s = await st();
ok(s.ended && s.dps.length === 19 && s.achievements.length === 7, 'progress survives a reload');
console.log('perf', JSON.stringify(await ev(() => window.__cart.perf())));
console.log('console errors:', JSON.stringify(errors));
ok(errors.length === 0, 'no console errors');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);

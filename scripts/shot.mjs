// usage: node scripts/shot.mjs <out.png> [width height touch] -- runs JS steps from stdin-less inline arg
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [out, w = '1280', h = '720', touch = '0', code = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch === '1', isMobile: touch === '1' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForTimeout(2500);
if (code) { const r = await new Function('page', `return (async()=>{${code}})()`)(page); if (r !== undefined) console.log(JSON.stringify(r)); }
await page.screenshot({ path: out });
console.log('errors:', JSON.stringify(errors));
await browser.close();

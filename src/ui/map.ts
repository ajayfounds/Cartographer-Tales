// The signature screen: a hand-drawn map that starts blank and inks itself in.
// Pure function of the save state -> SVG string, so it stays sharp at any
// pixel density and can be checked in tests.
import { zoneReveal, exploredFraction, gateFlow, stakeAligned, type GameState } from '../core/logic';
import {
  DISCOVERY_POINTS, ZONES, STAKES, POOL1, POOL2, CHANNELS, CHIMES, GRAVE, MESA, VAULT, RING_ROAD_R, CAIRN, type ZoneId,
} from '../world/layout';
import { rng } from '../world/terrain';
import { story } from '../content';

const S = 2.6;
const X = (x: number) => (500 + x * S).toFixed(1);
const Z = (z: number) => (500 + z * S).toFixed(1);
const P = (x: number, z: number) => `${X(x)},${Z(z)}`;
const INK = '#3b3123';
const PENCIL = '#8d806a';

function zoneGroup(s: GameState, zone: ZoneId, inked: string, sketch: string): string {
  const r = zoneReveal(s, zone);
  if (r <= 0) {
    // nothing known yet; once the road is open, mark where something must be
    if (!s.zones[1].complete) return '';
    const c = ZONES[zone];
    return `<text x="${X(c.cx)}" y="${Z(c.cz)}" class="m-q">?</text>`;
  }
  if (r < 1) return `<g class="m-sketch" opacity="${(0.35 + r).toFixed(2)}" stroke="${PENCIL}">${sketch}</g>`;
  return `<g class="m-ink" stroke="${INK}">${sketch}${inked}</g>`;
}

export function renderMap(s: GameState, player: { x: number; z: number; yaw: number } | null): string {
  const out: string[] = [];
  const z1 = ZONES[1], z3 = ZONES[3];
  const flow = gateFlow(s.gates);

  // roads appear once the hidden road is found
  let roads = `<path d="M ${P(0, 152)} L ${P(0, 100)}" />`;
  if (s.zones[1].complete) {
    roads += `<circle cx="500" cy="500" r="${RING_ROAD_R * S}" />`;
    roads += `<path d="M ${P(0, 100)} L ${P(0, VAULT.wallR)} M ${P(-RING_ROAD_R, 0)} L ${P(-92, 0)} M ${P(RING_ROAD_R, 0)} L ${P(84, 0)} M ${P(0, -RING_ROAD_R)} L ${P(0, -92)}" />`;
  }
  out.push(`<g class="m-road" stroke="${PENCIL}">${roads}</g>`);

  // zone 1
  const stakes = STAKES.map((st, i) =>
    s.stakes[i].found
      ? `<path d="M ${X(st.x - 1.6)} ${Z(st.z - 1.6)} l 8 8 m 0 -8 l -8 8" />` +
        (stakeAligned(s, i) ? `<path class="m-fine" d="M ${P(st.x, st.z)} L ${P(CAIRN.x, CAIRN.z)}" />` : '')
      : '',
  ).join('');
  out.push(zoneGroup(s, 1,
    `<path class="m-wash" d="M ${X(-17 - 3)} ${Z(128 + 2)} l 8 -14 l 8 14 z" />${stakes}`,
    `<circle cx="${X(z1.cx)}" cy="${Z(z1.cz)}" r="${37 * S}" stroke-dasharray="14 9" />`,
  ));

  // zone 2
  const rect = (p: { x0: number; x1: number; z0: number; z1: number }, cls: string) =>
    `<rect class="${cls}" x="${X(p.x0)}" y="${Z(p.z0)}" width="${(p.x1 - p.x0) * S}" height="${(p.z1 - p.z0) * S}" />`;
  const channels = Object.entries(CHANNELS)
    .map(([name, pts]) => `<polyline class="${flow.segments.includes(name) ? 'm-water' : 'm-fine'}" points="${pts.map(([x, z]) => P(x, z)).join(' ')}" />`)
    .join('');
  out.push(zoneGroup(s, 2,
    rect(POOL1, flow.pool1 ? 'm-pool' : 'm-dry') + rect(POOL2, flow.pool2 ? 'm-pool' : 'm-dry') + channels,
    `<rect x="${X(-172)}" y="${Z(-48)}" width="${82 * S}" height="${92 * S}" rx="6" />`,
  ));

  // zone 3
  const rand = rng(303);
  let pines = '';
  for (let i = 0; i < 46; i++) {
    const a = rand() * 6.283, r = Math.sqrt(rand()) * (z3.r - 3);
    const x = z3.cx + Math.cos(a) * r, z = z3.cz + Math.sin(a) * r;
    if (Math.hypot(x - GRAVE.x, z - GRAVE.z) < 8) continue;
    pines += `<path d="M ${X(x - 1.6)} ${Z(z + 1.6)} l 4.2 -10 l 4.2 10" />`;
  }
  const notes = CHIMES.slice(0, s.zones[3].complete ? CHIMES.length : s.chime)
    .map((c) => `<text class="m-note" x="${X(c.x)}" y="${Z(c.z)}">♪</text>`).join('');
  out.push(zoneGroup(s, 3,
    `<circle class="m-wash" cx="${X(GRAVE.x)}" cy="${Z(GRAVE.z)}" r="${6 * S}" />${notes}`,
    pines,
  ));

  // zone 4
  const contours = [33, ...MESA.radii].map((r) => `<circle cx="${X(MESA.cx)}" cy="${Z(MESA.cz)}" r="${r * S}" />`).join('');
  out.push(zoneGroup(s, 4,
    `<path class="m-fill" d="M ${X(MESA.cx - 2.6)} ${Z(MESA.cz + 2)} l 7 -13 l 7 13 z" />`,
    contours,
  ));

  // zone 5
  const gr = VAULT.wallR * S;
  out.push(zoneGroup(s, 5,
    `<circle class="m-wash" cx="500" cy="500" r="${5 * S}" /><path d="M 500 ${500 - 20} L 506 500 L 500 ${500 + 20} L 494 500 Z M ${500 - 20} 500 L 500 494 L ${500 + 20} 500 L 500 506 Z" class="m-fill" />`,
    `<path d="M ${500 + 8} ${500 + gr} A ${gr} ${gr} 0 1 0 ${500 - 8} ${500 + gr}" />`,
  ));

  // the truth seen from the summit: ruled construction lines, deliberately not wobbly
  let rose = '';
  if (s.zones[4].complete) {
    const R = 125 * S;
    rose = `<g class="m-rose"><circle cx="500" cy="500" r="${RING_ROAD_R * S}" /><circle cx="500" cy="500" r="${R}" />
      <path d="M 500 ${500 - R - 30} V ${500 + R + 30} M ${500 - R - 30} 500 H ${500 + R + 30}" />
      <path d="M ${500 - R * 0.707} ${500 - R * 0.707} L ${500 + R * 0.707} ${500 + R * 0.707} M ${500 + R * 0.707} ${500 - R * 0.707} L ${500 - R * 0.707} ${500 + R * 0.707}" stroke-dasharray="3 9" /></g>`;
  }

  // discovery points
  const dps = DISCOVERY_POINTS.map((d, i) =>
    s.dps.includes(d.id)
      ? `<g class="m-dp"><circle cx="${X(d.x)}" cy="${Z(d.z)}" r="11" /><text x="${X(d.x)}" y="${(500 + d.z * S + 4.5).toFixed(1)}">${i + 1}</text></g>`
      : '',
  ).join('');

  const names = ([1, 2, 3, 4, 5] as ZoneId[])
    .filter((z) => s.zones[z].complete)
    .map((z) => {
      const c = ZONES[z];
      const dy = z === 5 ? -VAULT.wallR - 5 : z === 4 ? c.r + 7 : -c.r - 4;
      return `<text class="m-name" x="${Math.min(800, Math.max(205, 500 + c.cx * S)).toFixed(0)}" y="${Z(c.cz + dy)}">${story.zones[String(z) as '1'].name}</text>`;
    }).join('');

  const me = player
    ? `<g transform="translate(${X(player.x)} ${Z(player.z)}) rotate(${(((Math.PI - player.yaw) * 180) / Math.PI).toFixed(0)})"><path class="m-me" d="M 0 -15 L 9 10 L 0 4 L -9 10 Z" /></g>`
    : '';

  const pct = Math.round(exploredFraction(s) * 100);
  return `<svg class="map-svg" viewBox="0 0 1000 1000" role="img" aria-label="Map of ${story.cast.region}, ${pct} percent explored">
  <defs>
    <filter id="wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="7" /></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="2" /><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.34  0 0 0 0 0.2  0 0 0 0.16 0" /></filter>
  </defs>
  <rect width="1000" height="1000" fill="#e7ddc2" /><rect width="1000" height="1000" filter="url(#grain)" />
  <rect x="18" y="18" width="964" height="964" class="m-border" /><rect x="28" y="28" width="944" height="944" class="m-border thin" />
  <g filter="url(#wob)" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6">${out.join('')}</g>
  ${rose}${names}${dps}${me}
  <text class="m-title" x="52" y="78">${story.cast.region.replace(/^the /, 'The ')}</text>
  <text class="m-sub" x="54" y="104">surveyed for ${story.cast.mentor}</text>
  <g transform="translate(920 86)" class="m-compass"><path d="M 0 -34 L 8 0 L 0 34 L -8 0 Z" /><text x="0" y="-42">N</text></g>
  <g class="m-scale"><path d="M 54 944 h 130 m -130 -6 v 12 m 65 -12 v 12 m 65 -12 v 12" /><text x="54" y="928">fifty paces</text></g>
  <text class="m-pct" x="946" y="946">${pct}% ${story.ui.explored}</text>
</svg>`;
}

export function legendHtml(s: GameState): string {
  const found = DISCOVERY_POINTS.filter((d) => s.dps.includes(d.id)).length;
  const rows = DISCOVERY_POINTS.map((d, i) =>
    s.dps.includes(d.id) ? `<li><b>${i + 1}</b> ${d.label}</li>` : `<li class="unknown"><b>${i + 1}</b> uncharted</li>`,
  ).join('');
  return `<p class="legend-count">${found} of ${DISCOVERY_POINTS.length} landmarks charted</p><ol class="legend">${rows}</ol>`;
}

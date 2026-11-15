// All narrative, hint, achievement and UI copy lives in story.json so it can be
// edited (or characters renamed, via "cast") without touching game code.
import story from './story.json';
import { CLIMB_ROUTE, GLYPH_NAMES } from '../core/logic';

export { story };

type TextId = keyof typeof story.texts;

function fill(s: string): string {
  const c = story.cast;
  return s
    .replaceAll('{mentor}', c.mentor)
    .replaceAll('{mentorShort}', c.mentorShort)
    .replaceAll('{partner}', c.partner)
    .replaceAll('{partnerShort}', c.partnerShort)
    .replaceAll('{partnerUpper}', c.partner.toUpperCase())
    .replaceAll('{region}', c.region)
    .replaceAll(
      '{route}',
      [...CLIMB_ROUTE]
        .reverse()
        .map((g, i) => `Tier ${CLIMB_ROUTE.length - i}: [[${g}]] ${GLYPH_NAMES[g]}`)
        .join('\n'),
    );
}

export function text(id: string): { title: string; body: string } {
  const t = story.texts[id as TextId];
  if (!t) return { title: id, body: '' };
  return { title: fill(t.title), body: fill(t.body) };
}

export function hasText(id: string): boolean {
  return id in story.texts;
}

export const t = (s: string) => fill(s);

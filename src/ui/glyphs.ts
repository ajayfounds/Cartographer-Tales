// The six carved marks, as SVG path data in a 100x100 box. Used by the HTML UI
// (inline SVG) and by the world (canvas textures), so they always match.
import type { Glyph } from '../core/logic';

export const GLYPH_PATHS: Record<Glyph, string> = {
  ring: 'M 73 27 A 32 32 0 1 0 82 50',
  wave: 'M 18 28 Q 34 16 50 28 T 82 28 M 18 44 Q 34 32 50 44 T 82 44 M 18 60 Q 34 48 50 60 T 82 60 M 14 80 H 86',
  bars: 'M 22 28 H 78 M 22 50 H 78 M 22 72 H 78',
  eye: 'M 12 50 Q 50 14 88 50 Q 50 86 12 50 Z M 50 41 A 9 9 0 1 0 50.1 41',
  fork: 'M 50 14 L 24 68 M 50 14 L 76 68 M 50 86 L 50.1 86',
  star: 'M 50 10 L 60 40 L 90 50 L 60 60 L 50 90 L 40 60 L 10 50 L 40 40 Z',
};

export function glyphSvg(g: Glyph, size = 28): string {
  return `<svg class="glyph" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${g}"><path d="${GLYPH_PATHS[g]}" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(GLYPH_PATHS[g]));
  ctx.restore();
}

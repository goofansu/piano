// Draws the blurred foliage shadows for the New session screen (docs/design-moonstone.md, Texture and light).
// Seeded, so the output is stable: node web/scripts/dappled-leaves.mjs web/src/assets/light
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1000, H = 800;
const rng = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const f = n => Math.round(n * 10) / 10;

// A leaf from its base at the origin pointing up (-y): slightly asymmetric, pointed tip.
function leaf(r, L, Wd) {
  const a = 0.85 + r() * 0.3, b = 0.85 + r() * 0.3, tip = L * (0.02 + r() * 0.05);
  return `M0 0C${f(Wd * a)} ${f(-L * 0.22)} ${f(Wd * 0.8 * a)} ${f(-L * 0.7)} ${f(tip)} ${f(-L)}C${f(-Wd * 0.75 * b)} ${f(-L * 0.72)} ${f(-Wd * b)} ${f(-L * 0.24)} 0 0Z`;
}

// A branch: a cubic stem with alternating leaves that shrink toward the tip, and occasional twigs.
function branch(r, x0, y0, angle, length, scale, depth = 0) {
  const parts = [];
  const bend = (r() - 0.5) * 0.9;
  const p = t => {
    const a = angle + bend * t;
    return [x0 + Math.cos(angle + bend * t * 0.5) * length * t, y0 + Math.sin(angle + bend * t * 0.5) * length * t, a];
  };
  const [x1, y1] = p(0.5), [x2, y2] = p(1);
  parts.push(`<path d="M${f(x0)} ${f(y0)}Q${f(x1 + (r() - 0.5) * 30)} ${f(y1 + (r() - 0.5) * 30)} ${f(x2)} ${f(y2)}" fill="none" stroke="#000" stroke-width="${f(6 * scale * (depth ? 0.6 : 1))}" stroke-linecap="round"/>`);
  const n = Math.round(length / (62 * scale));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 0.6);
    const [x, y, a] = p(t);
    const side = i % 2 ? 1 : -1;
    const grow = 1 - t * 0.45;
    const L = (95 + r() * 55) * scale * grow, Wd = L * (0.34 + r() * 0.12);
    const rot = (a * 180) / Math.PI + 90 + side * (34 + r() * 30) + (r() - 0.5) * 16;
    const petiole = 8 * scale;
    parts.push(`<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) translate(0 ${f(-petiole)})" d="${leaf(r, L, Wd)}"/>`);
    if (depth === 0 && r() < 0.16 && t > 0.2 && t < 0.8)
      parts.push(...branch(r, x, y, a + side * (0.5 + r() * 0.4), length * (0.3 + r() * 0.2), scale * 0.85, 1));
  }
  // A terminal leaf continues the stem.
  parts.push(`<path transform="translate(${f(x2)} ${f(y2)}) rotate(${f((p(1)[2] * 180) / Math.PI + 90)})" d="${leaf(r, 60 * scale, 20 * scale)}"/>`);
  return parts;
}

function svg(seed, branches) {
  const r = rng(seed);
  const near = [], far = [];
  for (const [x, y, deg, len, scale, layer] of branches) (layer ? far : near).push(...branch(r, x, y, (deg * Math.PI) / 180, len, scale));
  // Two depths: the near shadow is crisper and full strength, the far one softer and fainter.
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${W} ${H}">
<filter id="n" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${W + 200}" height="${H + 200}"><feGaussianBlur stdDeviation="10"/></filter>
<filter id="f" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${W + 200}" height="${H + 200}"><feGaussianBlur stdDeviation="20"/></filter>
<g filter="url(#f)" opacity=".7">${far.join("")}</g>
<g filter="url(#n)">${near.join("")}</g>
</svg>
`;
}

const out = process.argv[2];
// Top right: boughs reach in from the right edge and the top edge, leaning down and left.
writeFileSync(join(out, "leaves-top.svg"), svg(7, [
  [1060, 120, 168, 560, 1.15, 0],
  [1040, 360, 195, 420, 1, 0],
  [820, -60, 120, 380, 0.95, 0],
  [1080, 540, 200, 360, 1.1, 1],
  [760, -60, 128, 340, 1, 1],
]));
// Bottom left: boughs from the left and bottom edges, leaning up and right.
writeFileSync(join(out, "leaves-bottom.svg"), svg(23, [
  [-60, 640, -12, 560, 1.1, 0],
  [-40, 360, 12, 380, 1, 0],
  [200, 860, -75, 360, 0.95, 0],
  [-60, 180, 20, 320, 1.05, 1],
  [480, 860, -100, 260, 1, 1],
]));
console.log("ok");

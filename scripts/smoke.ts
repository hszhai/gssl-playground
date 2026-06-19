import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runShader, GSSL_SHADERS, type Vec3 } from '@hszhai/gssl';
import { makeSphere } from '../src/sphere.ts';
import { rasterize } from '../src/raster.ts';
import { perspective, lookAt, orbitEye } from '../src/m4.ts';
import { encodePNG } from './png.ts';

// Headless proof that the playground consumes the PUBLISHED @hszhai/gssl end to
// end: shade a sphere with each gallery shader, rasterize, and confirm non-blank
// output. Writes PNGs to scripts/out/ for eyeballing. Run: `node scripts/smoke.ts`.

const SIZE = 320;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const eye = orbitEye(0.7, 0.35, 3.2, [0, 0, 0]);
const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
const proj = perspective(Math.PI / 4, 1, 0.05, 50);
const light: Vec3 = [-0.55, 0.4, 0.28];
const bg: [number, number, number] = [0.58, 0.58, 0.62];
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let allOk = true;
for (const entry of GSSL_SHADERS) {
  const { splats, prov, restScale } = makeSphere(60, 120);
  const bus = runShader(entry.shade, splats, prov, { eye, light, time: 0 }, restScale);
  const yup = rasterize(splats, view, proj, SIZE, SIZE, bg, bus);
  // flip to top-down for PNG
  const img = new Uint8ClampedArray(yup.length);
  const row = SIZE * 4;
  for (let y = 0; y < SIZE; y++) img.set(yup.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
  writeFileSync(join(outDir, `${slug(entry.name)}.png`), encodePNG(img, SIZE, SIZE));

  // sanity: a meaningful fraction of pixels differ from the background
  let nonBg = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = img[i * 4]!, g = img[i * 4 + 1]!, b = img[i * 4 + 2]!;
    if (Math.abs(r - bg[0] * 255) > 6 || Math.abs(g - bg[1] * 255) > 6 || Math.abs(b - bg[2] * 255) > 6) nonBg++;
  }
  const frac = nonBg / (SIZE * SIZE);
  const ok = frac > 0.1; // the sphere fills a good chunk of frame
  allOk &&= ok;
  console.log(`  ${ok ? '✓' : '✗'} ${entry.name.padEnd(18)} non-bg ${(frac * 100).toFixed(1)}%`);
}
console.log(allOk ? 'smoke OK — @hszhai/gssl consumed and rendered' : 'smoke FAILED');
process.exit(allOk ? 0 : 1);

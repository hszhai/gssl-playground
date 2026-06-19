import { runShader, GSSL_SHADERS, type Vec3 } from '@hszhai/gssl';
import { makeSphere, type Cloud } from './sphere.ts';
import { rasterize } from './raster.ts';
import { perspective, lookAt, orbitEye } from './m4.ts';

// The playground app: consume @hszhai/gssl to shade a sphere, orbit it, swap
// shaders, move the light. GSSL produces the shade bus + writes colour/footprint;
// the local rasterizer (raster.ts) draws it. CPU render is on-demand (dirty flag)
// so it idles cheaply.

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const sel = document.getElementById('shader') as HTMLSelectElement;
const lAz = document.getElementById('lightAz') as HTMLInputElement;
const lEl = document.getElementById('lightEl') as HTMLInputElement;

const SIZE = 520;
canvas.width = SIZE; canvas.height = SIZE;

GSSL_SHADERS.forEach((s, i) => {
  const o = document.createElement('option');
  o.value = String(i); o.textContent = s.name;
  sel.appendChild(o);
});

let shaderIndex = 0;
let az = 0.7, el = 0.35, dist = 3.2;
let cloud: Cloud = makeSphere();
let dirty = true;

const bg: [number, number, number] = [0.58, 0.58, 0.62]; // neutral: ink + lit shaders both read
const proj = perspective(Math.PI / 4, 1, 0.05, 50);

function lightDir(): Vec3 {
  const a = +lAz.value, e = +lEl.value, ce = Math.cos(e);
  return [ce * Math.sin(a), Math.sin(e), ce * Math.cos(a)];
}

function render() {
  const eye = orbitEye(az, el, dist, [0, 0, 0]);
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const entry = GSSL_SHADERS[shaderIndex]!;
  const bus = runShader(entry.shade, cloud.splats, cloud.prov, { eye, light: lightDir(), time: performance.now() * 0.001 }, cloud.restScale);
  const yup = rasterize(cloud.splats, view, proj, SIZE, SIZE, bg, bus);
  const img = ctx.createImageData(SIZE, SIZE);
  const row = SIZE * 4;
  for (let y = 0; y < SIZE; y++) img.data.set(yup.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row); // y-up → top-down
  ctx.putImageData(img, 0, 0);
  hud.textContent = `@hszhai/gssl · ${entry.name} — drag to orbit · wheel to zoom · light sliders top-right`;
}

function loop() { if (dirty) { dirty = false; render(); } requestAnimationFrame(loop); }
requestAnimationFrame(loop);

sel.onchange = () => { shaderIndex = +sel.value; cloud = makeSphere(); dirty = true; }; // rebuild resets stroke rotations
lAz.oninput = () => { dirty = true; };
lEl.oninput = () => { dirty = true; };

let dragging = false, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  az -= (e.clientX - lx) * 0.01;
  el = Math.max(-1.5, Math.min(1.5, el + (e.clientY - ly) * 0.01));
  lx = e.clientX; ly = e.clientY; dirty = true;
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(1.6, Math.min(8, dist * (1 + e.deltaY * 0.001))); dirty = true; }, { passive: false });

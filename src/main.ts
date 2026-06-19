import { runShader, GSSL_SHADERS, type Vec3 } from '@hszhai/gssl';
import { makeSphere, type Cloud } from './sphere.ts';
import { rasterize } from './raster.ts';
import { perspective, lookAt, orbitEye } from './m4.ts';

// The playground app: consume @hszhai/gssl to shade a sphere, orbit it, swap
// shaders, move the light. The CPU rasterizer's cost is dominated by resolution,
// so we render at a LOW res while interacting and a FULL res once idle — smooth
// to drag, crisp at rest. Render is on-demand (dirty flag), so it idles cheaply.

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const sel = document.getElementById('shader') as HTMLSelectElement;
const lAz = document.getElementById('lightAz') as HTMLInputElement;
const lEl = document.getElementById('lightEl') as HTMLInputElement;

const DISP = 512;       // on-screen size
const FULL_RES = 384;   // render resolution when idle
const DRAG_RES = 192;   // render resolution while interacting (¼ the pixels)
canvas.width = DISP; canvas.height = DISP;
ctx.imageSmoothingEnabled = true;

// offscreen buffer the rasterizer writes into; scaled up to DISP on draw
const buf = document.createElement('canvas');
const bctx = buf.getContext('2d')!;

GSSL_SHADERS.forEach((s, i) => {
  const o = document.createElement('option');
  o.value = String(i); o.textContent = s.name;
  sel.appendChild(o);
});

let shaderIndex = 0;
let az = 0.7, el = 0.35, dist = 3.2;
let cloud: Cloud = makeSphere(48, 96); // ~4.5k splats (discs auto-size to cover)
let dirty = true;
let interacting = false;

const bg: [number, number, number] = [0.58, 0.58, 0.62];
const proj = perspective(Math.PI / 4, 1, 0.05, 50);

function lightDir(): Vec3 {
  const a = +lAz.value, e = +lEl.value, ce = Math.cos(e);
  return [ce * Math.sin(a), Math.sin(e), ce * Math.cos(a)];
}

function render(res: number) {
  const eye = orbitEye(az, el, dist, [0, 0, 0]);
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const entry = GSSL_SHADERS[shaderIndex]!;
  const t0 = performance.now();
  const yup = rasterize(cloud.splats, view, proj, res, res, bg,
    runShader(entry.shade, cloud.splats, cloud.prov, { eye, light: lightDir(), time: t0 * 0.001 }, cloud.restScale));
  buf.width = res; buf.height = res;
  const img = bctx.createImageData(res, res);
  const row = res * 4;
  for (let y = 0; y < res; y++) img.data.set(yup.subarray((res - 1 - y) * row, (res - y) * row), y * row); // y-up → top-down
  bctx.putImageData(img, 0, 0);
  ctx.drawImage(buf, 0, 0, res, res, 0, 0, DISP, DISP);
  const ms = (performance.now() - t0).toFixed(0);
  hud.textContent = `@hszhai/gssl · ${entry.name} · ${cloud.splats.length} splats @ ${res}px (${ms}ms) — drag to orbit · wheel to zoom`;
}

function loop() { if (dirty) { dirty = false; render(interacting ? DRAG_RES : FULL_RES); } requestAnimationFrame(loop); }
requestAnimationFrame(loop);

sel.onchange = () => { shaderIndex = +sel.value; cloud = makeSphere(48, 96); dirty = true; }; // rebuild resets stroke rotations
lAz.oninput = () => { dirty = true; };
lEl.oninput = () => { dirty = true; };

let dragging = false, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; interacting = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  az -= (e.clientX - lx) * 0.01;
  el = Math.max(-1.5, Math.min(1.5, el + (e.clientY - ly) * 0.01));
  lx = e.clientX; ly = e.clientY; dirty = true;
});
canvas.addEventListener('pointerup', () => { dragging = false; interacting = false; dirty = true; }); // final full-res pass
let zoomTimer = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist = Math.max(1.6, Math.min(8, dist * (1 + e.deltaY * 0.001)));
  interacting = true; dirty = true;
  clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => { interacting = false; dirty = true; }, 150); // crisp pass after the wheel settles
}, { passive: false });

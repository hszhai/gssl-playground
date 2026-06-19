import { SHADE_FLATNESS, SHADE_KERNEL, SHADE_STRIDE, KERNEL_RING, KERNEL_BASE_SIGMA, kernelQuadSigma, type Splat, type Vec4 } from '@hszhai/gssl';
import { quatToMat3, type Mat4 } from './m4.ts';

// The consumer's renderer: a tiny CPU EWA splat rasterizer. GSSL hands back the
// shade bus (flatness + kernel lanes) via runShader; this reads those lanes —
// using the package's exported SHADE_*/KERNEL_* constants — and rasterizes. The
// whole point: GSSL is renderer-agnostic, so the consumer brings this part.

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function kernelAlpha(m2: number, flatness: number, kernel: number): number {
  if (kernel === KERNEL_RING) {
    const m = Math.sqrt(m2);
    const halfw = 0.9 + (0.3 - 0.9) * flatness;
    const d = (m - 2.0) / halfw;
    return Math.exp(-0.5 * d * d);
  }
  const gaussA = Math.exp(-0.5 * m2);
  const flatA = 1 - smoothstep(6, 9, m2);
  return gaussA + (flatA - gaussA) * flatness;
}

const NEAR_CULL = -0.2, DILATE = 0.15;

/** Render shaded splats to a y-up RGBA8 buffer (flip rows for canvas/PNG). */
export function rasterize(
  splats: Splat[],
  view: Mat4,
  proj: Mat4,
  width: number,
  height: number,
  background: [number, number, number],
  shade?: Float32Array | null,
): Uint8ClampedArray {
  const N = width * height;
  const fr = new Float32Array(N), fg = new Float32Array(N), fb = new Float32Array(N);
  fr.fill(background[0]); fg.fill(background[1]); fb.fill(background[2]);

  interface P { depth: number; cx: number; cy: number; a: number; b: number; c: number; radius: number; r: number; g: number; bl: number; opacity: number; flatness: number; kernel: number; }
  const projected: P[] = [];

  for (let i = 0; i < splats.length; i++) {
    const s = splats[i]!;
    if (s.opacity < 0.004) continue;
    const px = s.position[0], py = s.position[1], pz = s.position[2];
    const camX = view[0]! * px + view[4]! * py + view[8]! * pz + view[12]!;
    const camY = view[1]! * px + view[5]! * py + view[9]! * pz + view[13]!;
    const camZ = view[2]! * px + view[6]! * py + view[10]! * pz + view[14]!;
    if (camZ > NEAR_CULL) continue;

    const Rw = quatToMat3(s.rotation as Vec4);
    const sx = s.scale[0], sy = s.scale[1], sz = s.scale[2];
    const w00 = view[0]!, w01 = view[4]!, w02 = view[8]!;
    const w10 = view[1]!, w11 = view[5]!, w12 = view[9]!;
    const w20 = view[2]!, w21 = view[6]!, w22 = view[10]!;
    const c0 = w00 * Rw[0]! + w01 * Rw[3]! + w02 * Rw[6]!, c1 = w00 * Rw[1]! + w01 * Rw[4]! + w02 * Rw[7]!, c2 = w00 * Rw[2]! + w01 * Rw[5]! + w02 * Rw[8]!;
    const c3 = w10 * Rw[0]! + w11 * Rw[3]! + w12 * Rw[6]!, c4 = w10 * Rw[1]! + w11 * Rw[4]! + w12 * Rw[7]!, c5 = w10 * Rw[2]! + w11 * Rw[5]! + w12 * Rw[8]!;
    const c6 = w20 * Rw[0]! + w21 * Rw[3]! + w22 * Rw[6]!, c7 = w20 * Rw[1]! + w21 * Rw[4]! + w22 * Rw[7]!, c8 = w20 * Rw[2]! + w21 * Rw[5]! + w22 * Rw[8]!;
    const rs0 = c0 * sx, rs1 = c1 * sy, rs2 = c2 * sz, rs3 = c3 * sx, rs4 = c4 * sy, rs5 = c5 * sz, rs6 = c6 * sx, rs7 = c7 * sy, rs8 = c8 * sz;
    const sig00 = rs0 * rs0 + rs1 * rs1 + rs2 * rs2;
    const sig01 = rs0 * rs3 + rs1 * rs4 + rs2 * rs5;
    const sig02 = rs0 * rs6 + rs1 * rs7 + rs2 * rs8;
    const sig11 = rs3 * rs3 + rs4 * rs4 + rs5 * rs5;
    const sig12 = rs3 * rs6 + rs4 * rs7 + rs5 * rs8;
    const sig22 = rs6 * rs6 + rs7 * rs7 + rs8 * rs8;

    const focalX = proj[0]! * width * 0.5, focalY = proj[5]! * height * 0.5;
    const z2 = camZ * camZ;
    const j00 = focalX / camZ, j02 = -focalX * camX / z2, j11 = focalY / camZ, j12 = -focalY * camY / z2;
    let cxx = j00 * j00 * sig00 + 2 * j00 * j02 * sig02 + j02 * j02 * sig22;
    const cxy = j00 * j11 * sig01 + j00 * j12 * sig02 + j02 * j11 * sig12 + j02 * j12 * sig22;
    let cyy = j11 * j11 * sig11 + 2 * j11 * j12 * sig12 + j12 * j12 * sig22;
    cxx += DILATE; cyy += DILATE;

    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-8) continue;
    const trace = cxx + cyy;
    const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
    const radius = 3 * Math.sqrt(Math.max((trace + disc) * 0.5, 0));

    const clipW = proj[3]! * camX + proj[7]! * camY + proj[11]! * camZ + proj[15]!;
    if (Math.abs(clipW) < 1e-6) continue;
    const ndcX = (proj[0]! * camX + proj[4]! * camY + proj[8]! * camZ + proj[12]!) / clipW;
    const ndcY = (proj[1]! * camX + proj[5]! * camY + proj[9]! * camZ + proj[13]!) / clipW;

    let flatness = 0, kernel = 0;
    if (shade) {
      const o = i * SHADE_STRIDE;
      const f = shade[o + SHADE_FLATNESS]; if (f === f) flatness = f!;
      const k = shade[o + SHADE_KERNEL]; if (k === k) kernel = k!;
    }
    projected.push({
      depth: -camZ, cx: (ndcX * 0.5 + 0.5) * width, cy: (ndcY * 0.5 + 0.5) * height,
      a: cyy / det, b: -cxy / det, c: cxx / det, radius,
      r: s.color[0], g: s.color[1], bl: s.color[2], opacity: s.opacity, flatness, kernel,
    });
  }
  projected.sort((x, y) => y.depth - x.depth);

  for (const p of projected) {
    const R = Math.ceil(p.radius * (kernelQuadSigma(p.kernel) / KERNEL_BASE_SIGMA));
    const x0 = Math.max(0, Math.floor(p.cx - R)), x1 = Math.min(width - 1, Math.ceil(p.cx + R));
    const y0 = Math.max(0, Math.floor(p.cy - R)), y1 = Math.min(height - 1, Math.ceil(p.cy + R));
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - p.cy, rowBase = yy * width;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - p.cx;
        const m2 = p.a * dx * dx + 2 * p.b * dx * dy + p.c * dy * dy;
        let al = kernelAlpha(m2, p.flatness, p.kernel) * p.opacity;
        if (al < 0.003) continue;
        if (al > 1) al = 1;
        const idx = rowBase + xx, ia = 1 - al;
        fr[idx] = p.r * al + fr[idx]! * ia;
        fg[idx] = p.g * al + fg[idx]! * ia;
        fb[idx] = p.bl * al + fb[idx]! * ia;
      }
    }
  }

  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { out[i * 4] = fr[i]! * 255; out[i * 4 + 1] = fg[i]! * 255; out[i * 4 + 2] = fb[i]! * 255; out[i * 4 + 3] = 255; }
  return out; // y-up
}

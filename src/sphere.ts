import type { Splat, SplatProvenance, Vec3 } from '@hszhai/gssl';

// A provenance-rich sphere of splats so every GSSL shader input (normal, uv,
// curvature, tangent) is well-defined — including the uv-space brick and the
// curvature-grain hatching.

export interface Cloud {
  splats: Splat[];
  prov: SplatProvenance[];
  restScale: Vec3[];
}

export function makeSphere(latBands = 70, lonBands = 140, radius = 1): Cloud {
  const splats: Splat[] = [];
  const prov: SplatProvenance[] = [];
  const restScale: Vec3[] = [];
  const s = radius * (Math.PI / latBands) * 0.9; // disc radius ≈ row spacing (tight = less overdraw)
  const thin = s * 0.3;

  for (let i = 1; i < latBands; i++) {
    const theta = (i / latBands) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let j = 0; j < lonBands; j++) {
      const phi = (j / lonBands) * 2 * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const n: Vec3 = [st * cp, ct, st * sp];
      const pos: Vec3 = [n[0] * radius, n[1] * radius, n[2] * radius];
      const tan: Vec3 = [ct * cp, -st, ct * sp]; // meridian tangent (∂pos/∂θ)
      splats.push({ position: pos, scale: [s, s, thin], rotation: [0, 0, 0, 1], color: [0, 0, 0], opacity: 1 });
      prov.push({ normal: n, uv: [theta, phi], curvature: [1 / radius, 1 / radius], tangent: tan });
      restScale.push([s, s, thin]);
    }
  }
  return { splats, prov, restScale };
}

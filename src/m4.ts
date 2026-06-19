import type { Vec3, Vec4 } from '@hszhai/gssl';

// Renderer-side math the playground brings itself — GSSL is renderer-agnostic, so
// a consumer supplies its own camera/quaternion helpers. (Only vectors/types come
// from the package.)

export type Mat4 = Float32Array; // 16, column-major

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

/** Row-major 3×3 rotation from a quaternion [x,y,z,w]. */
export function quatToMat3(q: Vec4): Float32Array {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}

/** Orbit eye position from azimuth/elevation/distance around a target. */
export function orbitEye(az: number, el: number, dist: number, target: Vec3): Vec3 {
  const ce = Math.cos(el);
  return [target[0] + dist * ce * Math.sin(az), target[1] + dist * Math.sin(el), target[2] + dist * ce * Math.cos(az)];
}

// ── EWA projection helpers (for the WebGL renderer) ──

export function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (Math.abs(w) < 1e-8) return [0, 0, 0];
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

/** Inverse of a symmetric 2×2 [[a,b],[b,c]] as {x,y,z} = [[x,y],[y,z]]. */
export function invertSym2D(a: number, b: number, c: number): { x: number; y: number; z: number } {
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-8) return { x: 1, y: 0, z: 1 };
  return { x: c / det, y: -b / det, z: a / det };
}

export interface Eigen2D { lambda1: number; lambda2: number; v1x: number; v1y: number; v2x: number; v2y: number; }

/** Eigen-decomposition of a symmetric 2×2 — eigenvalues + orthonormal eigenvectors. */
export function eigenDecompose2D(a: number, b: number, c: number): Eigen2D {
  const trace = a + c;
  const disc = Math.sqrt(Math.max(0, (a - c) * (a - c) + 4 * b * b));
  const lambda1 = (trace + disc) * 0.5;
  const lambda2 = (trace - disc) * 0.5;
  let v1x: number, v1y: number;
  if (Math.abs(b) < 1e-8) { v1x = 1; v1y = 0; }
  else { v1x = lambda1 - c; v1y = b; const l = Math.sqrt(v1x * v1x + v1y * v1y) || 1; v1x /= l; v1y /= l; }
  return { lambda1, lambda2, v1x, v1y, v2x: -v1y, v2y: v1x };
}

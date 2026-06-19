import { SHADE_FLATNESS, SHADE_KERNEL, SHADE_STRIDE, kernelQuadSigma, type Splat, type Vec4 } from '@hszhai/gssl';
import { quatToMat3, mat4TransformPoint, invertSym2D, eigenDecompose2D, type Mat4 } from './m4.ts';

// The consumer's WebGL2 renderer — the fast path. CPU does only the per-splat EWA
// projection (∝ count); the GPU does the fragment fill (the part that dominated
// the CPU rasterizer). It reads the GSSL shade bus (flatness + kernel lanes) and
// the per-fragment falloff mirrors the CPU rasterizer exactly. Ported from the
// emerging-splats renderer (the reference implementation).

const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_position;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec3 a_color;
layout(location=3) in float a_opacity;
layout(location=4) in vec3 a_conic;
layout(location=5) in float a_flatness;
layout(location=6) in float a_kernel;
out vec2 v_uv; out vec3 v_color; out float v_opacity; out vec3 v_conic; out float v_flatness; flat out int v_kernel;
void main() {
  gl_Position = a_position;
  v_uv = a_uv; v_color = a_color; v_opacity = a_opacity; v_conic = a_conic;
  v_flatness = a_flatness; v_kernel = int(a_kernel + 0.5);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_color; in float v_opacity; in vec3 v_conic; in float v_flatness; flat in int v_kernel;
out vec4 fragColor;
void main() {
  float m2 = v_conic.x*v_uv.x*v_uv.x + 2.0*v_conic.y*v_uv.x*v_uv.y + v_conic.z*v_uv.y*v_uv.y;
  float a;
  if (v_kernel == 1) {
    float m = sqrt(m2);
    float halfw = mix(0.9, 0.3, v_flatness);
    float d = (m - 2.0) / halfw;
    a = exp(-0.5 * d * d);
  } else {
    float gaussA = exp(-0.5 * m2);
    float flatA = 1.0 - smoothstep(6.0, 9.0, m2);
    a = mix(gaussA, flatA, v_flatness);
  }
  float alpha = a * v_opacity;
  if (alpha < 0.003) discard;
  fragColor = vec4(v_color, alpha);
}`;

const FPV = 15;          // floats per vertex
const FPQ = FPV * 4;     // per quad (4 verts)

interface PG { depth: number; data: Float32Array; }

export class GLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private splats: Splat[] = [];
  private shade: Float32Array | null = null;
  private vertexData = new Float32Array(0);
  private projected: PG[] = [];
  private cap = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = this.compile();
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    this.setupVAO();
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setSplats(splats: Splat[]) {
    this.splats = splats;
    if (splats.length > this.cap) {
      this.cap = splats.length;
      this.vertexData = new Float32Array(this.cap * FPQ);
      this.projected = Array.from({ length: this.cap }, () => ({ depth: 0, data: new Float32Array(FPQ) }));
      const idx = new Uint32Array(this.cap * 6);
      for (let i = 0; i < this.cap; i++) {
        const b = i * 4, o = i * 6;
        idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    }
  }

  setShade(shade: Float32Array | null) { this.shade = shade; }

  render(view: Mat4, proj: Mat4, width: number, height: number, bg: [number, number, number]) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const n = this.splats.length;
    if (!n) return;

    const focalX = proj[0]! * width * 0.5, focalY = proj[5]! * height * 0.5;
    const w00 = view[0]!, w01 = view[4]!, w02 = view[8]!;
    const w10 = view[1]!, w11 = view[5]!, w12 = view[9]!;
    const w20 = view[2]!, w21 = view[6]!, w22 = view[10]!;
    const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]];

    for (let i = 0; i < n; i++) {
      const g = this.splats[i]!;
      const pg = this.projected[i]!;
      const cam = mat4TransformPoint(view, g.position);
      const z = cam[2];
      if (z > -0.2) { pg.depth = Infinity; continue; }
      pg.depth = -z;

      let flat = 0, kernel = 0;
      if (this.shade) {
        const b = i * SHADE_STRIDE;
        const f = this.shade[b + SHADE_FLATNESS]; if (f === f) flat = f!;
        const k = this.shade[b + SHADE_KERNEL]; if (k === k) kernel = k!;
      }
      const quadSigma = kernelQuadSigma(kernel);

      const Rw = quatToMat3(g.rotation as Vec4);
      const sx = g.scale[0], sy = g.scale[1], sz = g.scale[2];
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

      const z2 = z * z;
      const j00 = focalX / z, j02 = -focalX * cam[0] / z2, j11 = focalY / z, j12 = -focalY * cam[1] / z2;
      let xx = j00 * j00 * sig00 + 2 * j00 * j02 * sig02 + j02 * j02 * sig22;
      const xy = j00 * j11 * sig01 + j00 * j12 * sig02 + j02 * j11 * sig12 + j02 * j12 * sig22;
      let yy = j11 * j11 * sig11 + 2 * j11 * j12 * sig12 + j12 * j12 * sig22;
      xx += 0.15; yy += 0.15;

      const conic = invertSym2D(xx, xy, yy);
      const eig = eigenDecompose2D(xx, xy, yy);
      const r1 = quadSigma * Math.sqrt(Math.max(0, eig.lambda1));
      const r2 = quadSigma * Math.sqrt(Math.max(0, eig.lambda2));

      const clipW = proj[3]! * cam[0] + proj[7]! * cam[1] + proj[11]! * cam[2] + proj[15]!;
      if (Math.abs(clipW) < 1e-6) { pg.depth = Infinity; continue; }
      const clipX = proj[0]! * cam[0] + proj[4]! * cam[1] + proj[8]! * cam[2] + proj[12]!;
      const clipY = proj[1]! * cam[0] + proj[5]! * cam[1] + proj[9]! * cam[2] + proj[13]!;
      const clipZ = proj[2]! * cam[0] + proj[6]! * cam[1] + proj[10]! * cam[2] + proj[14]!;
      const ndcX = clipX / clipW, ndcY = clipY / clipW;

      const data = pg.data;
      let off = 0;
      for (let c = 0; c < 4; c++) {
        const cx = corners[c]![0]!, cy = corners[c]![1]!;
        const pxOff = cx * eig.v1x * r1 + cy * eig.v2x * r2;
        const pyOff = cx * eig.v1y * r1 + cy * eig.v2y * r2;
        const vNdcX = ndcX + pxOff / (width * 0.5);
        const vNdcY = ndcY + pyOff / (height * 0.5);
        data[off] = vNdcX * clipW; data[off + 1] = vNdcY * clipW; data[off + 2] = clipZ; data[off + 3] = clipW;
        data[off + 4] = pxOff; data[off + 5] = pyOff;
        data[off + 6] = g.color[0]; data[off + 7] = g.color[1]; data[off + 8] = g.color[2];
        data[off + 9] = g.opacity;
        data[off + 10] = conic.x; data[off + 11] = conic.y; data[off + 12] = conic.z;
        data[off + 13] = flat; data[off + 14] = kernel;
        off += FPV;
      }
    }

    this.projected.sort((a, b) => b.depth - a.depth);
    let vOff = 0;
    for (let i = 0; i < n; i++) {
      const pg = this.projected[i]!;
      if (pg.depth === Infinity) continue;
      this.vertexData.set(pg.data, vOff);
      vOff += FPQ;
    }
    const visible = vOff / FPQ;
    if (!visible) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.subarray(0, vOff), gl.DYNAMIC_DRAW);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, visible * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private setupVAO() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const F = Float32Array.BYTES_PER_ELEMENT, stride = FPV * F;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 4 * F);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * F);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 9 * F);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 10 * F);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 13 * F);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 14 * F);
    gl.bindVertexArray(null);
  }

  private compile(): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }
}

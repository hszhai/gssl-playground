# GSSL playground

An interactive playground for [`@hszhai/gssl`](https://www.npmjs.com/package/@hszhai/gssl)
— the Gaussian-Splat Shading Language. Pick a shader from the gallery, orbit a
shaded sphere, and move the light.

This repo is also the **reference consumer** of the package: it depends only on
`@hszhai/gssl`'s public API (`runShader`, the shader gallery, the `Splat` /
`SplatProvenance` types, and the `SHADE_*` / `KERNEL_*` constants for reading the
shade bus) and brings **its own** renderer — proving GSSL is renderer-agnostic.

```
npm install      # pulls @hszhai/gssl from npm
npm run dev       # open the playground
```

- **`src/sphere.ts`** — a provenance-rich sphere (normal / uv / curvature / tangent).
- **`src/glraster.ts`** — the app's **WebGL2** EWA splat renderer (the fast path);
  reads the shade bus via the package's exported lane constants.
- **`src/raster.ts`** — a tiny **CPU** EWA rasterizer; used by the headless smoke
  test (no GPU in Node) and as the readable reference for the same math.
- **`src/snippets.ts`** — the GSSL source shown in the code panel.
- **`src/main.ts`** — the app: shader dropdown, orbit, light sliders, the live
  `over(…)` compose control, and the teaching panel.
- **`npm run smoke`** — headless render of every gallery shader to `scripts/out/`,
  asserting the package is consumed and produces non-blank output.

## How it consumes GSSL

```ts
import { runShader, GSSL_SHADERS } from '@hszhai/gssl';

const bus = runShader(GSSL_SHADERS[i].shade, splats, provenance, { eye, light, time }, restScale);
// runShader writes color/opacity/footprint into `splats` and returns the shade
// bus (flatness + kernel per splat) — hand both to your renderer.
```

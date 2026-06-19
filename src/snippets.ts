// The GSSL source of each gallery shader, shown in the playground's code panel so
// people can SEE the language. Curated/condensed from the real stdlib — faithful
// to what each shader does, trimmed for reading. The teaching point: a shader is
// one pure function returning the colour path (color/opacity) AND the splat-native
// FOOTPRINT lanes (flatness, kernel, aniso/stroke).

export const SNIPPETS: Record<string, string> = {
  'Gooch': `// cool→warm by Lambert — a colour-path classic
const gooch: GsslShader = (i) => {
  const t = 0.5 * (1 + dot(norm(i.normal), norm(i.light)));
  return { color: lerp(cool, warm, t), opacity: 1,
           flatness: 0, kernel: KERNEL_GAUSSIAN };
};`,

  'Toon': `// quantized Lambert + flatness:1 → crisp cel DISCS
// (flatness is splat-native: a flat-topped, un-feathered footprint)
const toon: GsslShader = (i) => ({
  color: toonColor(i.normal, i.light, albedo, 4),
  opacity: 1, flatness: 1, kernel: KERNEL_GAUSSIAN,
});`,

  'Fresnel rim': `// grazing glow; the rim switches to the RING kernel
// → a splat-native halo a pixel shader can't make
const fresnelRim: GsslShader = (i) => {
  const f = pow(1 - abs(dot(n, viewDir)), 3);
  const onRim = f > 0.55;
  return { color: lerp(base, glow, f), opacity: 1,
           flatness: onRim ? 0.5 : 0,
           kernel: onRim ? KERNEL_RING : KERNEL_GAUSSIAN };
};`,

  'Blinn-Phong': `// ambient + Lambert + (n·h)^s specular
const blinnPhong: GsslShader = (i) => {
  const diff = max(0, dot(n, l));
  const spec = pow(max(0, dot(n, h)), 48);
  return { color: add(scale(albedo, 0.13 + 0.85*diff), spec),
           opacity: 1, flatness: 0, kernel: KERNEL_GAUSSIAN };
};`,

  'Brick': `// procedural brick in UV space (exact provenance)
// brick faces go flat (crisp tiles), mortar stays soft
const brick: GsslShader = (i) => {
  const isBrick = brickCell(i.uv);
  return { color: scale(isBrick ? brickCol : mortarCol, light),
           opacity: 1, flatness: isBrick ? 1 : 0,
           kernel: KERNEL_GAUSSIAN };
};`,

  'Hatch (strokes)': `// shadow stretches each splat into an oriented STROKE
// aniso reshapes the footprint along the splat's own axes
const hatch: GsslShader = (i) => {
  const shadow = 1 - max(0, dot(n, l));
  return { color: lerp(paper, ink, shadow), opacity: 1,
           flatness: 1, kernel: KERNEL_GAUSSIAN,
           aniso: [1 + 5.5*shadow, 1 - 0.82*shadow] };
};`,

  'Curvature hatch': `// strokes laid along the surface GRAIN (provenance.tangent)
// — the marks follow the form's actual structure
const curvatureHatch: GsslShader = (i) => {
  const tone = 1 - max(0, dot(n, l));
  return { color: lerp(paper, ink, tone), opacity: 1,
           flatness: 1, kernel: KERNEL_GAUSSIAN,
           stroke: { dir: i.tangent,
                     long: 1 + 6*tone, thin: 1 - 0.82*tone } };
};`,

  'Gooch ⊕ Rim': `// COMPOSITION — the operator that makes it a language:
// the same recipe, a gooch body that grows a rim halo
const goochRim = over(gooch, fresnelRim, grazingMask(0.5));`,

  'Toon ⊕ Rim': `// the SAME recipe over a different base
const toonRim = over(toon, fresnelRim, grazingMask(0.45));`,
};

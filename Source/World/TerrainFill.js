// pure terrain attribute computation - runs in the TerrainWorker off the main
// thread (and inline as a fallback / in Node tests). No THREE, no DOM.
import { makeHeightfield, WATER_Y } from "../Core/Heightfield.js";
import { Fbm2 } from "../Core/Noise.js";
import { buildSitePaths, pathDistance } from "../Core/SitePaths.js";

const clamp01 = (t) => Math.max(0, Math.min(1, t));

// port of BufferGeometry.computeVertexNormals (indexed path): same face
// order, same accumulation and rounding, so the output matches the mesh
function vertexNormals(xs, ys, zs, index) {
  const n = xs.length;
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < index.length; i += 3) {
    const vA = index[i];
    const vB = index[i + 1];
    const vC = index[i + 2];
    const abx = xs[vA] - xs[vB];
    const aby = ys[vA] - ys[vB];
    const abz = zs[vA] - zs[vB];
    const cbx = xs[vC] - xs[vB];
    const cby = ys[vC] - ys[vB];
    const cbz = zs[vC] - zs[vB];
    const cx = cby * abz - cbz * aby;
    const cy = cbz * abx - cbx * abz;
    const cz = cbx * aby - cby * abx;
    nor[vA * 3] += cx;
    nor[vA * 3 + 1] += cy;
    nor[vA * 3 + 2] += cz;
    nor[vB * 3] += cx;
    nor[vB * 3 + 1] += cy;
    nor[vB * 3 + 2] += cz;
    nor[vC * 3] += cx;
    nor[vC * 3 + 1] += cy;
    nor[vC * 3 + 2] += cz;
  }
  for (let i = 0; i < n; i++) {
    const x = nor[i * 3];
    const y = nor[i * 3 + 1];
    const z = nor[i * 3 + 2];
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    nor[i * 3] = x * inv;
    nor[i * 3 + 1] = y * inv;
    nor[i * 3 + 2] = z * inv;
  }
  return nor;
}

export function fillTerrain(seed, xs, zs, index) {
  const hf = makeHeightfield(seed);
  const n = xs.length;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = hf.heightAt(xs[i], zs[i]);
  const normals = vertexNormals(xs, heights, zs, index);

  const tint = Fbm2(seed + 55);
  const patches = Fbm2(seed + 56);
  const paths = buildSitePaths(hf.sites, hf.streamDist);
  const colors = new Float32Array(n * 3);
  const splat = new Float32Array(n * 3); // grass, dirt, rock
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = heights[i];
    const z = zs[i];
    const ny = normals[i * 3 + 1];

    let rock = clamp01((0.8 - ny) / 0.16) + clamp01((y - 11) / 7) * 0.5;
    let dirt =
      clamp01((WATER_Y + 0.8 - y) / 1.0) +
      Math.max(0, patches(x * 0.02, z * 0.02, 3) - 0.42) * 1.4;
    if (y < WATER_Y) dirt += 2;
    for (const s of hf.sites) {
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      // worn ground at buildings
      if (d2 < 81) dirt += clamp01((9 - Math.sqrt(d2)) / 5) * 0.7;
    }
    const pd = pathDistance(paths, x, z);
    if (pd < 2.4) dirt += clamp01((2.4 - pd) / 1.5) * 0.85; // worn paths
    rock = Math.min(rock, 1.5);
    dirt = Math.min(dirt, 1.5);
    const grass = Math.max(0, 1 - rock - dirt);
    const sum = grass + dirt + rock;
    splat[i * 3] = grass / sum;
    splat[i * 3 + 1] = dirt / sum;
    splat[i * 3 + 2] = rock / sum;

    // macro tint only - the texture layers carry the detail
    const n1 = tint(x * 0.015, z * 0.015, 3);
    const n2 = tint(x * 0.07, z * 0.07, 2);
    let b = 0.88 + n1 * 0.18 + n2 * 0.07;
    if (y < WATER_Y) b *= clamp01(1 + (y - WATER_Y) * 0.35); // darken the bed
    colors[i * 3] = b * (1 + n1 * 0.05);
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b * (1 - n1 * 0.05);
  }
  return { heights, normals, colors, splat };
}

// bilinear sampler over the vertex lattice (row-major: z by row, x by column)
export function makeGridSampler(heights, res, worldSize) {
  const ht = res + 1;
  const half = worldSize / 2;
  const sw = worldSize / res;
  return (x, z) => {
    const gx = Math.min(res - 1e-9, Math.max(0, (x + half) / sw));
    const gz = Math.min(res - 1e-9, Math.max(0, (z + half) / sw));
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const a = heights[iz * ht + ix];
    const b = heights[iz * ht + ix + 1];
    const c = heights[(iz + 1) * ht + ix];
    const d = heights[(iz + 1) * ht + ix + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

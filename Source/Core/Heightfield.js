import { Fbm2 } from "./Noise.js";
import { Mulberry } from "./Rng.js";

export const WORLD_SIZE = 400;
export const HALF = WORLD_SIZE / 2;
export const WATER_Y = 0;
export const BOUND = HALF - 8;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

const SITE_TYPES = ["cabin", "cabin", "cabin", "barn", "ruin", "tower"];

export function makeHeightfield(seed = 7) {
  const base = Fbm2(seed);
  const detail = Fbm2(seed + 101);
  const rng = Mulberry(seed + 977);

  const streamX = (z) =>
    45 * Math.sin(z * 0.011 + 0.6) + 22 * Math.sin(z * 0.029 + 1.7);
  const streamDist = (x, z) => Math.abs(x - streamX(z));

  // terrain before building pads: rolling hills, valley + carved bed at the stream
  const rawH = (x, z) => {
    let h =
      (base(x * 0.008, z * 0.008, 5) * 0.5 + 0.5) * 17 +
      1.5 +
      detail(x * 0.06, z * 0.06, 2) * 0.7;
    const d = streamDist(x, z);
    h *= 0.35 + 0.65 * smooth(clamp01(d / 55));
    const s = smooth(clamp01(1 - d / 10));
    if (s > 0) h = lerp(h, WATER_Y - 2.3, s);
    // rim: ground rises toward the boundary so the mesh edge hides behind it
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smooth(clamp01((edge - 168) / 30)) * 14 * (1 - s);
    return h;
  };

  // deterministic building sites on flat-ish ground away from the stream
  const sites = [];
  for (
    let tries = 0;
    tries < 600 && sites.length < SITE_TYPES.length;
    tries++
  ) {
    const x = (rng() * 2 - 1) * (HALF - 70);
    const z = (rng() * 2 - 1) * (HALF - 70);
    if (streamDist(x, z) < 30) continue;
    const h = rawH(x, z);
    if (h < 1.2) continue;
    const dx = Math.abs(rawH(x + 7, z) - rawH(x - 7, z));
    const dz = Math.abs(rawH(x, z + 7) - rawH(x, z - 7));
    if (dx > 2.4 || dz > 2.4) continue;
    if (sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 34 ** 2)) continue;
    sites.push({
      x,
      z,
      y: h,
      type: SITE_TYPES[sites.length],
      rot: ((rng() * 4) | 0) * (Math.PI / 2),
    });
  }

  const heightAt = (x, z) => {
    let h = rawH(x, z);
    for (const s of sites) {
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 196) {
        const d = Math.sqrt(d2);
        h = lerp(s.y, h, smooth(clamp01((d - 7) / 7)));
      }
    }
    return h;
  };

  return { seed, heightAt, rawH, streamX, streamDist, sites };
}

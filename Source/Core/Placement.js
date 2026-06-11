// pure world-layout logic: every placement decision and RNG draw lives here,
// Node-testable; the World/* modules only turn these records into meshes.
// Draw order is load-bearing - the world is one seed.
import { Mulberry } from "./Rng.js";
import { HALF, WATER_Y } from "./Heightfield.js";

const TREE_TRIES = 9000;
const TREE_CELL = 5;
const TREE_CAP = 1500;
const ROCK_COUNT = 680;
const LOG_COUNT = 16;
const T_WALL = 0.2;

export const clearOfSites = (hf, x, z, pad) =>
  hf.sites.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > pad * pad);

// local solid/pad center -> world AABB; replicates the mesh-side THREE
// rotY+translate to ~1ulp (rotations are multiples of 90deg)
export function worldAabb(s, x, y, z, rot) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const sx = s.x || 0;
  const sz = s.z || 0;
  const wx = cos * sx + sin * sz + x;
  const wz = -sin * sx + cos * sz + z;
  const w = rot % Math.PI === 0 ? s.w : s.d;
  const d = rot % Math.PI === 0 ? s.d : s.w;
  return {
    minX: wx - w / 2,
    maxX: wx + w / 2,
    minZ: wz - d / 2,
    maxZ: wz + d / 2,
    minY: y + (s.y0 ?? -1),
    maxY: y + (s.h ?? 0),
  };
}

// --- trees ---

// one Mulberry stream per tree, drawn ONCE: full tree and impostor must
// consume identical values (the LOD-parity invariant from review round 1)
export function treeParams(i, hfSeed, specSeed) {
  const r = Mulberry(i * 7 + hfSeed + specSeed);
  const rot = r() * Math.PI * 2;
  const ys = 0.92 + r() * 0.16;
  const g = 0.95 + r() * 0.3;
  const red = g * (0.95 + r() * 0.1);
  return { rot, ys, g, red };
}

export function placeTrees(rng, hf) {
  const pines = [];
  const oaks = [];
  const cells = new Set();
  for (let i = 0; i < TREE_TRIES; i++) {
    if (pines.length + oaks.length >= TREE_CAP) break;
    const x = (rng() * 2 - 1) * (HALF - 12);
    const z = (rng() * 2 - 1) * (HALF - 12);
    const key = `${Math.floor(x / TREE_CELL)},${Math.floor(z / TREE_CELL)}`;
    if (cells.has(key)) continue;
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.8) continue;
    const slope = Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z));
    if (slope > 1.7) continue;
    if (!clearOfSites(hf, x, z, 13)) continue;
    cells.add(key);
    (rng() < 0.55 ? pines : oaks).push({ x, y, z, s: 0.75 + rng() * 0.75 });
  }
  return { pines, oaks };
}

// --- buildings ---

// hollow shell: walls with a doorway gap in +z; each box doubles as a solid
function shellWalls({ W, D, H, doorW, doorH, doorOff }) {
  const T = T_WALL;
  const zf = (D - T) / 2;
  const wl = doorOff - doorW / 2 + W / 2;
  const wr = W / 2 - (doorOff + doorW / 2);
  const walls = [];
  const wall = (w, h, d, x, y, z, y0) => walls.push({ w, h, d, x, y, z, y0 });
  if (wl > 0.05) wall(wl, H, T, (-W / 2 + doorOff - doorW / 2) / 2, H / 2, zf);
  if (wr > 0.05) wall(wr, H, T, (doorOff + doorW / 2 + W / 2) / 2, H / 2, zf);
  // lintel above the doorway
  wall(doorW + 0.12, H - doorH, T, doorOff, doorH + (H - doorH) / 2, zf, doorH);
  wall(W, H, T, 0, H / 2, -zf);
  wall(T, H, D - 2 * T, -(W - T) / 2, H / 2, 0);
  wall(T, H, D - 2 * T, (W - T) / 2, H / 2, 0);
  return walls;
}

const wallSolid = (b) => ({
  w: b.w,
  d: b.d,
  x: b.x,
  z: b.z,
  h: b.y + b.h / 2,
  y0: b.y0,
});

function shellSolidList(opt, walls) {
  const solids = walls.map(wallSolid);
  // floor: step-band standable, interior-only (no exterior phantom ledge)
  solids.push({
    w: opt.W - 2 * T_WALL,
    d: opt.D - 2 * T_WALL,
    x: 0,
    z: 0,
    h: 0.12,
  });
  return solids;
}

export function cabinParts(seed) {
  const rng = Mulberry(seed);
  const W = 4.8 + rng() * 1.6;
  const D = 4 + rng() * 1.2;
  const H = 2.6 + rng() * 0.5;
  const wallMatIdx = (rng() * 3) | 0; // [log, wood, log]
  const opt = {
    W,
    D,
    H,
    roofH: 1.5 + rng() * 0.4,
    doorW: 1.15,
    doorH: 2.05,
    doorOff: (rng() - 0.5) * (W - 2.6),
  };
  const walls = shellWalls(opt);
  const solids = shellSolidList(opt, walls);
  const chH = H + 1.1;
  solids.push({ w: 0.55, d: 0.55, x: W / 2 + 0.2, z: -D / 4, h: chH });
  return {
    kind: "cabin",
    ...opt,
    wallMatIdx,
    chH,
    walls,
    solids,
    pads: [{ x: 0, z: 0, w: W, d: D }],
  };
}

export function barnParts(seed) {
  const rng = Mulberry(seed);
  const W = 6.5 + rng() * 1.5;
  const D = 9 + rng() * 2;
  const H = 3.4 + rng() * 0.5;
  const opt = {
    W,
    D,
    H,
    roofH: 2.2 + rng() * 0.5,
    doorW: 2.6,
    doorH: 2.9,
    doorOff: 0,
  };
  const walls = shellWalls(opt);
  return {
    kind: "barn",
    ...opt,
    walls,
    solids: shellSolidList(opt, walls),
    pads: [{ x: 0, z: 0, w: W, d: D }],
  };
}

export function shedParts(seed) {
  const rng = Mulberry(seed);
  const W = 2.5 + rng() * 0.7;
  const D = 2.1 + rng() * 0.5;
  const H = 2.05;
  const T = 0.18;
  const wallMatIdx = rng() < 0.5 ? 0 : 1; // [wood, barn]
  const walls = [
    { w: W, h: H, d: T, x: 0, z: -(D - T) / 2 },
    { w: T, h: H, d: D - 2 * T, x: -(W - T) / 2, z: 0 },
    { w: T, h: H, d: D - 2 * T, x: (W - T) / 2, z: 0 },
  ];
  return {
    kind: "shed",
    W,
    D,
    H,
    T,
    wallMatIdx,
    walls,
    solids: walls.map((b) => ({ w: b.w, d: b.d, x: b.x, z: b.z, h: b.h })),
    pads: [{ x: 0, z: -0.1, w: W + 0.5, d: D + 0.7 }],
  };
}

export function ruinParts(seed) {
  const rng = Mulberry(seed);
  const walls = [];
  const solids = [];
  // prettier-ignore
  for (const [wx, wz, w, d] of [
    [0, -3.2, 6.5, 0.6], [0, 3.2, 6.5, 0.6],
    [-3.2, 0, 0.6, 5.8], [3.2, 0, 0.6, 5.8],
  ]) {
    const h = 0.7 + rng() * 2;
    walls.push({ w, h, d, x: wx, z: wz });
    // collider top matches the mesh (group sinks 0.06): standable, no hover
    solids.push({ w, h: h - 0.06, d, x: wx, z: wz });
  }
  const rubble = [];
  for (let i = 0; i < 7; i++) {
    const s = 0.25 + rng() * 0.5;
    rubble.push({ s, x: (rng() * 2 - 1) * 4.5, z: (rng() * 2 - 1) * 4.5 });
  }
  return { kind: "ruin", walls, rubble, solids, pads: [] };
}

export function towerParts() {
  const solids = [];
  // prettier-ignore
  for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]])
    solids.push({ w: 0.3, h: 4.8, d: 0.3, x: lx, z: lz });
  return { kind: "tower", solids, pads: [] };
}

export const partsFor = (type, seed) =>
  type === "cabin"
    ? cabinParts(seed)
    : type === "barn"
      ? barnParts(seed)
      : type === "shed"
        ? shedParts(seed)
        : type === "ruin"
          ? ruinParts(seed)
          : towerParts();

// fences, barrels, woodpiles, and the well; candidates inside a building
// AABB are skipped without changing the RNG draw order
export function placeProps(hf, boxes, circles) {
  const rng = Mulberry(hf.seed + 83);
  const posts = [];
  const rails = [];
  const barrels = [];
  const woodLogs = [];
  const inBuilding = (x, z, r) =>
    boxes.some(
      (b) =>
        x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r,
    );

  for (const s of hf.sites) {
    if (s.type === "ruin" || s.type === "tower") continue;
    const runs = 1 + (rng() < 0.5 ? 1 : 0);
    for (let rI = 0; rI < runs; rI++) {
      const a0 = rng() * Math.PI * 2;
      let px = s.x + Math.cos(a0) * (7 + rng() * 3);
      let pz = s.z + Math.sin(a0) * (7 + rng() * 3);
      let dir = a0 + Math.PI / 2 + (rng() - 0.5) * 0.6;
      const segs = 3 + ((rng() * 3) | 0);
      let prev = null;
      let placedRun = 0;
      for (let k = 0; k <= segs; k++) {
        const py = hf.heightAt(px, pz);
        if (py < 0.5) break; // ran into the stream valley
        if (inBuilding(px, pz, 0.45)) break; // run would pierce a wall
        const cur = { x: px, y: py, z: pz };
        posts.push(cur);
        circles.push({ x: px, z: pz, r: 0.18, topY: py + 1.05 });
        if (prev) {
          rails.push([prev, cur]);
          for (const t of [0.3, 0.7]) {
            circles.push({
              x: prev.x + (cur.x - prev.x) * t,
              z: prev.z + (cur.z - prev.z) * t,
              r: 0.16,
              topY: Math.max(prev.y, cur.y) + 1,
            });
          }
        }
        prev = cur;
        placedRun++;
        dir += (rng() - 0.5) * 0.5;
        px += Math.cos(dir) * 2.2;
        pz += Math.sin(dir) * 2.2;
      }
      if (placedRun === 1) {
        posts.pop(); // a lone rail-less post looks broken
        circles.pop();
      }
    }
    const nB = 1 + ((rng() * 3) | 0);
    for (let k = 0; k < nB; k++) {
      const a = rng() * Math.PI * 2;
      const r = 3.6 + rng() * 3;
      const bx = s.x + Math.cos(a) * r;
      const bz = s.z + Math.sin(a) * r;
      const bs = 0.8 + rng() * 0.35;
      // the 3.6-6.6 ring can land inside the randomized barn (half-diag ~6.8)
      if (inBuilding(bx, bz, 0.45)) continue;
      const by = hf.heightAt(bx, bz);
      barrels.push({ x: bx, y: by, z: bz, s: bs });
      circles.push({ x: bx, z: bz, r: 0.42, topY: by + 1 });
    }
  }

  // woodpiles at two cabins
  const cabins = hf.sites.filter((s) => s.type === "cabin");
  for (const s of cabins.slice(0, 2)) {
    const a = rng() * Math.PI * 2;
    const cx = s.x + Math.cos(a) * 5.5;
    const cz = s.z + Math.sin(a) * 5.5;
    const rot = rng() * Math.PI;
    const side = rot + Math.PI / 2;
    if (inBuilding(cx, cz, 1.0)) continue;
    const cy = hf.heightAt(cx, cz);
    // prettier-ignore
    for (const [o, oy] of [[-0.3, 0.14], [0, 0.14], [0.3, 0.14], [-0.15, 0.4], [0.15, 0.4], [0, 0.66]]) {
      woodLogs.push({
        x: cx + Math.cos(side) * o,
        z: cz + Math.sin(side) * o,
        y: cy + oy,
        rot,
      });
    }
    circles.push({ x: cx, z: cz, r: 0.95, topY: cy + 0.85 });
  }

  let well = null;
  const w = cabins[0];
  if (w) {
    const a = Mulberry(hf.seed + 91)() * Math.PI * 2;
    const wx = w.x + Math.cos(a) * 6.5;
    const wz = w.z + Math.sin(a) * 6.5;
    if (!inBuilding(wx, wz, 1.2)) {
      well = { x: wx, z: wz, y: hf.heightAt(wx, wz) - 0.05 };
      circles.push({ x: wx, z: wz, r: 1.15, topY: well.y + 1 });
    }
  }
  return { posts, rails, barrels, woodLogs, well };
}

export function buildingLayout(hf) {
  const structures = [];
  const colliders = [];
  const interiors = []; // roofed footprints (rain occlusion etc.)
  const circles = [];
  const add = (parts, x, y, z, rot) => {
    structures.push({ parts, x, y, z, rot });
    for (const s of parts.solids) colliders.push(worldAabb(s, x, y, z, rot));
    for (const p of parts.pads) interiors.push(worldAabb(p, x, y, z, rot));
  };

  hf.sites.forEach((site, i) => {
    add(
      partsFor(site.type, hf.seed + i * 13),
      site.x,
      site.y,
      site.z,
      site.rot,
    );
  });

  // lean-to sheds near a cabin and the barn add silhouette variety
  [hf.sites[1], hf.sites[3]].filter(Boolean).forEach((s, k) => {
    const rng = Mulberry(hf.seed + 301 + k * 17);
    for (let t = 0; t < 8; t++) {
      const a = rng() * Math.PI * 2;
      const sx = s.x + Math.cos(a) * (9 + rng() * 2);
      const sz = s.z + Math.sin(a) * (9 + rng() * 2);
      const sy = hf.heightAt(sx, sz);
      const flat =
        Math.abs(hf.heightAt(sx + 2, sz) - hf.heightAt(sx - 2, sz)) +
        Math.abs(hf.heightAt(sx, sz + 2) - hf.heightAt(sx, sz - 2));
      if (sy < 0.6 || flat > 0.7) continue;
      const parts = shedParts(hf.seed + 401 + k);
      add(parts, sx, sy, sz, ((rng() * 4) | 0) * (Math.PI / 2));
      break;
    }
  });

  const props = placeProps(hf, colliders, circles);
  return { structures, props, colliders, interiors, circles };
}

// --- clutter ---

export function clutterLayout(hf, buildingBoxes = []) {
  const rng = Mulberry(hf.seed + 67);
  const circles = [];
  const inBuilding = (x, z, r) =>
    buildingBoxes.some(
      (b) =>
        x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r,
    );
  const slopeAt = (x, z) =>
    Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z)) +
    Math.abs(hf.heightAt(x, z + 2) - hf.heightAt(x, z - 2));

  const rocks = [];
  for (let i = 0; i < ROCK_COUNT * 8 && rocks.length < ROCK_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y - 0.4) continue;
    const steep = slopeAt(x, z) > 1.6;
    if (!steep && rng() > 0.45) continue;
    if (hf.sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 7 ** 2))
      continue;
    const s = 0.25 + rng() * rng() * 1.5;
    if (inBuilding(x, z, 0.8 * s + 0.2)) continue;
    const rx = rng() * 0.5;
    const ry = rng() * Math.PI * 2;
    const rz = rng() * 0.5;
    const g = 0.42 + rng() * 0.26;
    const cr = g * (1 + rng() * 0.08);
    const cb = g * (0.94 + rng() * 0.06);
    rocks.push({ x, y, z, s, rx, ry, rz, cr, cg: g, cb });
    if (s > 0.6) circles.push({ x, z, r: 0.8 * s, topY: y + 0.7 * s });
  }

  const logs = [];
  for (let i = 0; i < LOG_COUNT * 30 && logs.length < LOG_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 16);
    const z = (rng() * 2 - 1) * (HALF - 16);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.5 || slopeAt(x, z) > 1.2) continue;
    if (hf.sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 11 ** 2))
      continue;
    if (inBuilding(x, z, 2.5)) continue; // sheds sit outside the 11m site gate
    const L = 2.6 + rng() * 2;
    const a = rng() * Math.PI * 2;
    const tilt = (rng() - 0.5) * 0.1;
    logs.push({ x, y, z, L, a, tilt });
    for (const t of [-0.32, 0, 0.32]) {
      circles.push({
        x: x + Math.cos(a) * t * L,
        z: z - Math.sin(a) * t * L,
        r: 0.42,
        topY: y + 0.55,
      });
    }
  }
  return { rocks, logs, circles };
}

// --- spawn ---

export function findSpawn(hf, worldCircles, buildingBoxes) {
  const home = hf.sites[0] ?? { x: 0, z: 0 };
  const clear = (x, z) =>
    hf.heightAt(x, z) > 0.5 &&
    !worldCircles.some(
      (c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1.2) ** 2,
    ) &&
    !buildingBoxes.some(
      (b) =>
        x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1,
    );
  let sx = home.x + 10;
  let sz = home.z + 10;
  outer: for (let rad = 10; rad <= 26; rad += 4) {
    for (let a = 0; a < 12; a++) {
      const x = home.x + Math.cos((a / 12) * Math.PI * 2) * rad;
      const z = home.z + Math.sin((a / 12) * Math.PI * 2) * rad;
      if (clear(x, z)) {
        sx = x;
        sz = z;
        break outer;
      }
    }
  }
  return { x: sx, z: sz, yaw: Math.atan2(sx, sz), clear: clear(sx, sz) };
}

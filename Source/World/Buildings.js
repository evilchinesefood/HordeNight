import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Mulberry } from "../Core/Rng.js";
import {
  plankTextureSet,
  shingleTextureSet,
  stoneTextureSet,
  barrelTextureSet,
} from "../Engine/Textures.js";

const GRIME_H = 1.4; // ground-line dirt fades out by this height

// collapse a structure's many small meshes into one mesh per material
function mergeGroup(src) {
  const byMat = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    o.updateMatrix();
    geo.applyMatrix4(o.matrix);
    if (!geo.attributes.color) {
      const n = geo.attributes.position.count;
      geo.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3),
      );
    }
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    out.add(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  return out;
}

function makeMats() {
  const std = (t, extra = {}) =>
    new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.nor,
      roughness: 0.95,
      vertexColors: true,
      ...extra,
    });
  return {
    log: std(plankTextureSet(31)),
    wood: std(plankTextureSet(41, "#7d6e5a")),
    barn: std(plankTextureSet(51, "#7d3b2c", "#7a5f3e")),
    roof: std(shingleTextureSet(33), { side: THREE.DoubleSide }),
    stone: std(stoneTextureSet(35)),
    barrel: std(barrelTextureSet(37), { vertexColors: false }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x2c2118,
      roughness: 1,
      vertexColors: true,
    }),
    propDark: new THREE.MeshStandardMaterial({ color: 0x1d1814, roughness: 1 }),
  };
}

// finalize a triangle-soup geometry: planar uvs (no diagonal tangent seams
// under the roof normal map), white vertex colors, flat normals
function soupGeo(v, uvOf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const n = v.length / 3;
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3).fill(1); // required: shared mats use vertexColors
  for (let i = 0; i < n; i++) {
    const [u0, v0] = uvOf(v[i * 3], v[i * 3 + 1], v[i * 3 + 2], i);
    uv[i * 2] = u0;
    uv[i * 2 + 1] = v0;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // sequential index: mergeGeometries refuses indexed+non-indexed mixes
  geo.setIndex(Array.from({ length: n }, (_, i) => i));
  geo.computeVertexNormals();
  return geo;
}

// triangular prism, ridge along z, base at y=0
function gableGeo(w, h, d) {
  const x = w / 2;
  const z = d / 2;
  // prettier-ignore
  const v = [
    -x,0,z,  x,0,z,  0,h,z,
    x,0,-z, -x,0,-z, 0,h,-z,
    -x,0,-z, -x,0,z, 0,h,z,  -x,0,-z, 0,h,z, 0,h,-z,
    x,0,z,  x,0,-z, 0,h,-z,  x,0,z,  0,h,-z, 0,h,z,
  ];
  // end caps map in (x,y); slopes in (z, along-slope) - both planar
  return soupGeo(v, (px, py, pz, i) =>
    i < 6 ? [px * 0.35, py * 0.35] : [pz * 0.35, py * 0.5],
  );
}

// roof slopes only (no end caps) - gable ends belong to the walls
function roofGeo(w, h, d) {
  const x = w / 2;
  const z = d / 2;
  // prettier-ignore
  const v = [
    -x,0,z,  0,h,z,  0,h,-z,   -x,0,z,  0,h,-z, -x,0,-z,
    x,0,z,  x,0,-z, 0,h,-z,    x,0,z,  0,h,-z,  0,h,z,
  ];
  return soupGeo(v, (_, py, pz) => [pz * 0.35, py * 0.5]);
}

// plank sheathing under the roof slopes (reversed winding, faces down)
function roofUnderGeo(w, h, d) {
  const x = w / 2;
  const z = d / 2;
  // prettier-ignore
  const v = [
    -x,0,z,  0,h,-z, 0,h,z,    -x,0,z, -x,0,-z,  0,h,-z,
    x,0,z,  0,h,-z,  x,0,-z,   x,0,z,  0,h,z,   0,h,-z,
  ];
  return soupGeo(v, (_, py, pz) => [pz * 0.35, py * 0.5]);
}

// wall-material gable triangle closing the space under the roof
function gableCapGeo(w, h) {
  const x = w / 2;
  // prettier-ignore
  const v = [-x,0,0,  x,0,0,  0,h,0];
  return soupGeo(v, (px, py) => [px * 0.35, py * 0.35]);
}

// box with ground-line grime baked into vertex colors
function box(w, h, d, mat, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + y) / GRIME_H, 0, 1);
    const c = 0.5 + 0.5 * t;
    col[i * 3] = c;
    col[i * 3 + 1] = c * (0.97 + 0.03 * t);
    col[i * 3 + 2] = c * (0.9 + 0.1 * t);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// hollow rectangular shell: floor, 4 walls with a doorway gap in +z,
// ceiling, wall-material gable caps, overhanging roof. The player can
// walk inside; every wall segment is its own collider.
function shell(g, solids, wallMat, MAT, opt) {
  const { W, D, H, roofH, doorW, doorH, doorOff } = opt;
  const T = 0.2;
  const wall = (w, h, d, x, y, z, y0) => {
    g.add(box(w, h, d, wallMat, x, y, z));
    solids.push({ w, d, x, z, h: y + h / 2, y0 });
  };
  const zf = (D - T) / 2;
  const wl = doorOff - doorW / 2 + W / 2;
  const wr = W / 2 - (doorOff + doorW / 2);
  if (wl > 0.05) wall(wl, H, T, (-W / 2 + doorOff - doorW / 2) / 2, H / 2, zf);
  if (wr > 0.05) wall(wr, H, T, (doorOff + doorW / 2 + W / 2) / 2, H / 2, zf);
  // lintel above the doorway
  wall(doorW + 0.12, H - doorH, T, doorOff, doorH + (H - doorH) / 2, zf, doorH);
  wall(W, H, T, 0, H / 2, -zf);
  wall(T, H, D - 2 * T, -(W - T) / 2, H / 2, 0);
  wall(T, H, D - 2 * T, (W - T) / 2, H / 2, 0);
  // floor (step-band standable) + ceiling
  g.add(box(W - 0.06, 0.12, D - 0.06, MAT.wood, 0, 0.06, 0));
  solids.push({ w: W, d: D, x: 0, z: 0, h: 0.12 });
  g.add(box(W, 0.1, D, MAT.wood, 0, H + 0.05, 0));
  for (const zc of [zf + T / 2 - 0.01, -(zf + T / 2 - 0.01)]) {
    const cap = new THREE.Mesh(gableCapGeo(W, roofH), wallMat);
    cap.position.set(0, H, zc);
    if (zc < 0) cap.rotation.y = Math.PI;
    g.add(cap);
  }
  const roof = new THREE.Mesh(roofGeo(W + 0.7, roofH, D + 0.8), MAT.roof);
  roof.position.y = H;
  g.add(roof);
  const under = new THREE.Mesh(roofUnderGeo(W + 0.7, roofH, D + 0.8), MAT.wood);
  under.position.y = H - 0.04;
  g.add(under);
}

function cabin(MAT, seed) {
  const rng = Mulberry(seed);
  const g = new THREE.Group();
  const solids = [];
  const W = 4.8 + rng() * 1.6;
  const D = 4 + rng() * 1.2;
  const H = 2.6 + rng() * 0.5;
  const wallMat = [MAT.log, MAT.wood, MAT.log][(rng() * 3) | 0];
  shell(g, solids, wallMat, MAT, {
    W,
    D,
    H,
    roofH: 1.5 + rng() * 0.4,
    doorW: 1.15,
    doorH: 2.05,
    doorOff: (rng() - 0.5) * (W - 2.6),
  });
  // window panel + chimney
  g.add(box(0.9, 0.8, 0.06, MAT.dark, W / 4, H * 0.62, -(D / 2 + 0.01)));
  const chH = H + 1.1;
  g.add(box(0.55, chH, 0.55, MAT.stone, W / 2 + 0.2, chH / 2, -D / 4));
  solids.push({ w: 0.55, d: 0.55, x: W / 2 + 0.2, z: -D / 4, h: chH });
  return { group: g, solids };
}

function barn(MAT, seed) {
  const rng = Mulberry(seed);
  const g = new THREE.Group();
  const solids = [];
  const W = 6.5 + rng() * 1.5;
  const D = 9 + rng() * 2;
  const H = 3.4 + rng() * 0.5;
  shell(g, solids, MAT.barn, MAT, {
    W,
    D,
    H,
    roofH: 2.2 + rng() * 0.5,
    doorW: 2.6,
    doorH: 2.9,
    doorOff: 0,
  });
  // loft window + white door trim
  g.add(box(0.9, 0.9, 0.06, MAT.dark, 0, H + 0.7, D / 2 + 0.42));
  g.add(box(0.18, 3, 0.16, MAT.wood, -1.42, 1.5, D / 2 + 0.02));
  g.add(box(0.18, 3, 0.16, MAT.wood, 1.42, 1.5, D / 2 + 0.02));
  return { group: g, solids };
}

// small open-front lean-to: 3 walls, tilted plank roof
function shed(MAT, seed) {
  const rng = Mulberry(seed);
  const g = new THREE.Group();
  const solids = [];
  const W = 2.5 + rng() * 0.7;
  const D = 2.1 + rng() * 0.5;
  const H = 2.05;
  const T = 0.18;
  const wallMat = rng() < 0.5 ? MAT.wood : MAT.barn;
  const wall = (w, h, d, x, z) => {
    g.add(box(w, h, d, wallMat, x, h / 2, z));
    solids.push({ w, d, x, z, h });
  };
  wall(W, H, T, 0, -(D - T) / 2);
  wall(T, H, D - 2 * T, -(W - T) / 2, 0);
  wall(T, H, D - 2 * T, (W - T) / 2, 0);
  const roof = box(W + 0.5, 0.1, D + 0.7, MAT.wood, 0, H + 0.18, -0.1);
  roof.rotation.x = 0.16;
  g.add(roof);
  return { group: g, solids };
}

function ruin(MAT, seed) {
  const rng = Mulberry(seed);
  const g = new THREE.Group();
  const solids = [];
  const walls = [
    [0, -3.2, 6.5, 0.6],
    [0, 3.2, 6.5, 0.6],
    [-3.2, 0, 0.6, 5.8],
    [3.2, 0, 0.6, 5.8],
  ];
  for (const [wx, wz, w, d] of walls) {
    const h = 0.7 + rng() * 2;
    g.add(box(w, h, d, MAT.stone, wx, h / 2, wz));
    solids.push({ w, h: h + 0.2, d, x: wx, z: wz });
  }
  for (let i = 0; i < 7; i++) {
    const s = 0.25 + rng() * 0.5;
    g.add(
      box(
        s,
        s,
        s,
        MAT.stone,
        (rng() * 2 - 1) * 4.5,
        s / 2,
        (rng() * 2 - 1) * 4.5,
      ),
    );
  }
  return { group: g, solids };
}

function tower(MAT) {
  const g = new THREE.Group();
  const solids = [];
  // prettier-ignore
  for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    g.add(box(0.3, 4.8, 0.3, MAT.wood, lx, 2.4, lz));
    solids.push({ w: 0.3, h: 4.8, d: 0.3, x: lx, z: lz });
  }
  g.add(box(3.2, 0.25, 3.2, MAT.wood, 0, 4.9, 0));
  // prettier-ignore
  for (const [rx, rz, w, d] of [
    [0, -1.55, 3.2, 0.1], [0, 1.55, 3.2, 0.1],
    [-1.55, 0, 0.1, 3.2], [1.55, 0, 0.1, 3.2],
  ]) {
    g.add(box(w, 0.9, d, MAT.wood, rx, 5.5, rz));
  }
  const roof = new THREE.Mesh(gableGeo(3.6, 1.1, 3.6), MAT.roof);
  roof.position.y = 6;
  g.add(roof);
  return { group: g, solids };
}

function well(MAT) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.0, 0.9, 10),
    MAT.stone,
  );
  ring.position.y = 0.45;
  g.add(ring);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 10),
    MAT.propDark,
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.82;
  g.add(water);
  g.add(box(0.12, 2.2, 0.12, MAT.wood, -0.95, 1.1, 0));
  g.add(box(0.12, 2.2, 0.12, MAT.wood, 0.95, 1.1, 0));
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6),
    MAT.propDark,
  );
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 2.05;
  g.add(bar);
  const roof = new THREE.Mesh(gableGeo(2.7, 0.7, 1.7), MAT.roof);
  roof.position.y = 2.2;
  g.add(roof);
  return g;
}

function addProps(hf, group, circles, MAT) {
  const rng = Mulberry(hf.seed + 83);
  const posts = [];
  const rails = [];
  const barrels = [];
  const logs = [];
  const propWood = MAT.wood.clone();
  propWood.vertexColors = false;

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
      const by = hf.heightAt(bx, bz);
      barrels.push({ x: bx, y: by, z: bz, s: 0.8 + rng() * 0.35 });
      circles.push({ x: bx, z: bz, r: 0.42, topY: by + 1 });
    }
  }

  // woodpiles at two cabins
  const cabins = hf.sites.filter((s) => s.type === "cabin");
  for (const s of cabins.slice(0, 2)) {
    const a = rng() * Math.PI * 2;
    const cx = s.x + Math.cos(a) * 5.5;
    const cz = s.z + Math.sin(a) * 5.5;
    const cy = hf.heightAt(cx, cz);
    const rot = rng() * Math.PI;
    const side = rot + Math.PI / 2;
    // prettier-ignore
    for (const [o, oy] of [[-0.3, 0.14], [0, 0.14], [0.3, 0.14], [-0.15, 0.4], [0.15, 0.4], [0, 0.66]]) {
      logs.push({
        x: cx + Math.cos(side) * o,
        z: cz + Math.sin(side) * o,
        y: cy + oy,
        rot,
      });
    }
    circles.push({ x: cx, z: cz, r: 0.95, topY: cy + 0.85 });
  }

  const m = new THREE.Matrix4();
  const m2 = new THREE.Matrix4();
  const sv = new THREE.Vector3();

  const postMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.5, 0),
    propWood,
    posts.length,
  );
  posts.forEach((p, i) => {
    m.makeRotationY(Mulberry(i + hf.seed)() * Math.PI);
    m.setPosition(p.x, p.y, p.z);
    postMesh.setMatrixAt(i, m);
  });

  const railMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.09, 0.05).translate(0.5, 0, 0),
    propWood,
    rails.length * 2,
  );
  rails.forEach(([a, b], i) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy, dz);
    [0.45, 0.85].forEach((hgt, j) => {
      m.makeRotationY(Math.atan2(-dz, dx));
      m2.makeRotationZ(Math.asin(dy / len));
      m.multiply(m2);
      m.scale(sv.set(len, 1, 1));
      m.setPosition(a.x, a.y + hgt, a.z);
      railMesh.setMatrixAt(i * 2 + j, m);
    });
  });

  const barrelMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.36, 0.32, 1, 10).translate(0, 0.5, 0),
    MAT.barrel,
    barrels.length,
  );
  const col = new THREE.Color();
  barrels.forEach((b, i) => {
    m.makeRotationY(Mulberry(i * 3 + hf.seed)() * Math.PI * 2);
    m.scale(sv.set(b.s, b.s, b.s));
    m.setPosition(b.x, b.y - 0.03, b.z);
    barrelMesh.setMatrixAt(i, m);
    barrelMesh.setColorAt(i, col.setScalar(0.82 + Mulberry(i * 5)() * 0.3));
  });

  const logMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.15, 1.5, 7).rotateZ(Math.PI / 2),
    propWood,
    logs.length,
  );
  logs.forEach((l, i) => {
    m.makeRotationY(l.rot);
    m.setPosition(l.x, l.y, l.z);
    logMesh.setMatrixAt(i, m);
  });

  group.add(postMesh, railMesh, barrelMesh, logMesh);

  // well near the first cabin
  const w = cabins[0];
  if (w) {
    const a = Mulberry(hf.seed + 91)() * Math.PI * 2;
    const wx = w.x + Math.cos(a) * 6.5;
    const wz = w.z + Math.sin(a) * 6.5;
    const wg = mergeGroup(well(MAT));
    wg.position.set(wx, hf.heightAt(wx, wz) - 0.05, wz);
    group.add(wg);
    circles.push({ x: wx, z: wz, r: 1.15, topY: wg.position.y + 1 });
  }
}

export function createBuildings(hf) {
  const MAT = makeMats();
  const group = new THREE.Group();
  const colliders = [];
  const circles = [];
  const v = new THREE.Vector3();
  const builders = {
    cabin: (seed) => cabin(MAT, seed),
    barn: (seed) => barn(MAT, seed),
    ruin: (seed) => ruin(MAT, seed),
    tower: () => tower(MAT),
    shed: (seed) => shed(MAT, seed),
  };

  const place = ({ group: raw, solids }, x, y, z, rot) => {
    const g = mergeGroup(raw);
    g.position.set(x, y - 0.06, z);
    g.rotation.y = rot;
    group.add(g);
    g.updateMatrixWorld(true);
    for (const s of solids) {
      // local solid center -> world (rotation is a multiple of 90deg, AABB stays valid)
      v.set(s.x || 0, 0, s.z || 0).applyMatrix4(g.matrixWorld);
      const w = rot % Math.PI === 0 ? s.w : s.d;
      const d = rot % Math.PI === 0 ? s.d : s.w;
      colliders.push({
        minX: v.x - w / 2,
        maxX: v.x + w / 2,
        minZ: v.z - d / 2,
        maxZ: v.z + d / 2,
        minY: y + (s.y0 ?? -1),
        maxY: y + s.h,
      });
    }
  };

  hf.sites.forEach((site, i) => {
    place(
      builders[site.type](hf.seed + i * 13),
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
      place(
        shed(MAT, hf.seed + 401 + k),
        sx,
        sy,
        sz,
        ((rng() * 4) | 0) * (Math.PI / 2),
      );
      break;
    }
  });

  addProps(hf, group, circles, MAT);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { group, colliders, circles };
}

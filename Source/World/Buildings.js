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
    roof: std(shingleTextureSet(33)),
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const n = v.length / 3;
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3).fill(1); // required: shared mats use vertexColors
  for (let i = 0; i < n; i++) {
    uv[i * 2] = (v[i * 3] + v[i * 3 + 1]) * 0.35;
    uv[i * 2 + 1] = v[i * 3 + 2] * 0.35;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
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

function cabin(MAT) {
  const g = new THREE.Group();
  g.add(box(5, 2.8, 4.2, MAT.log, 0, 1.4, 0));
  const roof = new THREE.Mesh(gableGeo(5.7, 1.7, 5), MAT.roof);
  roof.position.y = 2.8;
  g.add(roof);
  g.add(box(1, 2, 0.12, MAT.dark, -0.8, 1, 2.12));
  g.add(box(0.9, 0.8, 0.12, MAT.dark, 1.3, 1.7, 2.12));
  g.add(box(0.12, 0.8, 0.9, MAT.dark, 2.52, 1.7, -0.5));
  g.add(box(0.55, 1.7, 0.55, MAT.stone, 1.9, 3.4, -1.4));
  return { group: g, solids: [{ w: 5, h: 4.5, d: 4.2 }] };
}

function barn(MAT) {
  const g = new THREE.Group();
  g.add(box(7, 3.6, 10, MAT.barn, 0, 1.8, 0));
  const roof = new THREE.Mesh(gableGeo(8, 2.6, 10.8), MAT.roof);
  roof.position.y = 3.6;
  g.add(roof);
  g.add(box(2.6, 2.9, 0.14, MAT.dark, 0, 1.45, 5.04));
  g.add(box(0.9, 0.9, 0.14, MAT.dark, 0, 4.1, 5.04));
  // white trim
  g.add(box(0.18, 3, 0.16, MAT.wood, -1.42, 1.5, 5.02));
  g.add(box(0.18, 3, 0.16, MAT.wood, 1.42, 1.5, 5.02));
  return { group: g, solids: [{ w: 7, h: 6.2, d: 10 }] };
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
    cabin: () => cabin(MAT),
    barn: () => barn(MAT),
    ruin: (seed) => ruin(MAT, seed),
    tower: () => tower(MAT),
  };

  hf.sites.forEach((site, i) => {
    const { group: raw, solids } = builders[site.type](hf.seed + i * 13);
    const g = mergeGroup(raw);
    g.position.set(site.x, site.y - 0.06, site.z);
    g.rotation.y = site.rot;
    group.add(g);
    g.updateMatrixWorld(true);

    for (const s of solids) {
      // local solid center -> world (rotation is a multiple of 90deg, AABB stays valid)
      v.set(s.x || 0, 0, s.z || 0).applyMatrix4(g.matrixWorld);
      const w = site.rot % Math.PI === 0 ? s.w : s.d;
      const d = site.rot % Math.PI === 0 ? s.d : s.w;
      colliders.push({
        minX: v.x - w / 2,
        maxX: v.x + w / 2,
        minZ: v.z - d / 2,
        maxZ: v.z + d / 2,
        minY: site.y - 1,
        maxY: site.y + s.h,
      });
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

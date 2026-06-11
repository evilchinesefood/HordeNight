import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Mulberry } from "../Core/Rng.js";
import { buildingLayout } from "../Core/Placement.js";
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
    roof: std(shingleTextureSet(33), {
      side: THREE.DoubleSide,
      // DoubleSide writes both faces into the shadow map at identical
      // depth -> guaranteed acne stripes on the slopes; front faces only
      shadowSide: THREE.FrontSide,
    }),
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

// hollow shell meshes from Placement parts: walls (which double as the
// colliders), floor, ceiling, gable caps, overhanging roof
function shellMeshes(g, p, wallMat, MAT) {
  const { W, D, H, roofH } = p;
  const T = 0.2;
  for (const b of p.walls) g.add(box(b.w, b.h, b.d, wallMat, b.x, b.y, b.z));
  g.add(box(W - 0.06, 0.12, D - 0.06, MAT.wood, 0, 0.06, 0));
  g.add(box(W, 0.1, D, MAT.wood, 0, H + 0.05, 0));
  // double-sided caps: the attic gable is visible during indoor jumps
  const capMat = wallMat.clone();
  capMat.side = THREE.DoubleSide;
  const zf = (D - T) / 2;
  for (const zc of [zf + T / 2 - 0.01, -(zf + T / 2 - 0.01)]) {
    const cap = new THREE.Mesh(gableCapGeo(W, roofH), capMat);
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

function cabinMeshes(p, MAT) {
  const g = new THREE.Group();
  shellMeshes(g, p, [MAT.log, MAT.wood, MAT.log][p.wallMatIdx], MAT);
  // window panel + chimney
  g.add(box(0.9, 0.8, 0.06, MAT.dark, p.W / 4, p.H * 0.62, -(p.D / 2 + 0.01)));
  g.add(box(0.55, p.chH, 0.55, MAT.stone, p.W / 2 + 0.2, p.chH / 2, -p.D / 4));
  return g;
}

function barnMeshes(p, MAT) {
  const g = new THREE.Group();
  shellMeshes(g, p, MAT.barn, MAT);
  // loft window (embedded through the gable cap plane) + white door trim
  g.add(box(0.9, 0.9, 0.06, MAT.dark, 0, p.H + 0.7, p.D / 2));
  g.add(box(0.18, 3, 0.16, MAT.wood, -1.42, 1.5, p.D / 2 + 0.02));
  g.add(box(0.18, 3, 0.16, MAT.wood, 1.42, 1.5, p.D / 2 + 0.02));
  return g;
}

// small open-front lean-to: 3 walls, tilted plank roof
function shedMeshes(p, MAT) {
  const g = new THREE.Group();
  const wallMat = [MAT.wood, MAT.barn][p.wallMatIdx];
  for (const b of p.walls)
    g.add(box(b.w, b.h, b.d, wallMat, b.x, b.h / 2, b.z));
  const roof = box(p.W + 0.5, 0.1, p.D + 0.7, MAT.wood, 0, p.H + 0.18, -0.1);
  roof.rotation.x = 0.16;
  g.add(roof);
  return g;
}

function ruinMeshes(p, MAT) {
  const g = new THREE.Group();
  for (const w of p.walls)
    g.add(box(w.w, w.h, w.d, MAT.stone, w.x, w.h / 2, w.z));
  for (const r of p.rubble)
    g.add(box(r.s, r.s, r.s, MAT.stone, r.x, r.s / 2, r.z));
  return g;
}

function towerMeshes(MAT) {
  const g = new THREE.Group();
  // prettier-ignore
  for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    g.add(box(0.3, 4.8, 0.3, MAT.wood, lx, 2.4, lz));
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
  return g;
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

function addPropMeshes(hf, group, props, MAT) {
  const { posts, rails, barrels, woodLogs, well: wellAt } = props;
  const propWood = MAT.wood.clone();
  propWood.vertexColors = false;

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
    woodLogs.length,
  );
  woodLogs.forEach((l, i) => {
    m.makeRotationY(l.rot);
    m.setPosition(l.x, l.y, l.z);
    logMesh.setMatrixAt(i, m);
  });

  group.add(postMesh, railMesh, barrelMesh, logMesh);

  if (wellAt) {
    const wg = mergeGroup(well(MAT));
    wg.position.set(wellAt.x, wellAt.y, wellAt.z);
    group.add(wg);
  }
}

export function createBuildings(hf) {
  const MAT = makeMats();
  const group = new THREE.Group();
  // every placement decision (and RNG draw) lives in Core/Placement.js
  const layout = buildingLayout(hf);

  const meshesFor = (p) =>
    p.kind === "cabin"
      ? cabinMeshes(p, MAT)
      : p.kind === "barn"
        ? barnMeshes(p, MAT)
        : p.kind === "shed"
          ? shedMeshes(p, MAT)
          : p.kind === "ruin"
            ? ruinMeshes(p, MAT)
            : towerMeshes(MAT);

  for (const s of layout.structures) {
    const g = mergeGroup(meshesFor(s.parts));
    g.position.set(s.x, s.y - 0.06, s.z);
    g.rotation.y = s.rot;
    group.add(g);
  }

  addPropMeshes(hf, group, layout.props, MAT);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    colliders: layout.colliders,
    circles: layout.circles,
    interiors: layout.interiors,
    structures: layout.structures,
    props: layout.props,
  };
}

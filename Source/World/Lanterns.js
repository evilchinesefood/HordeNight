// hanging lanterns inside every roofed building (cabins, barn, sheds).
// All cages+glass merge into TWO static meshes (emissive glass needs no
// light), while TWO roaming PointLights cover the nearest lanterns -
// constant light count, because adding/removing lights recompiles every
// lit shader in the scene.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// pure: world-space lantern anchors, one per roofed interior
export function lanternLayout(structures) {
  const out = [];
  for (const s of structures) {
    const p = s.parts;
    let l = null;
    if (p.kind === "cabin") l = [0, p.H - 0.42, 0];
    else if (p.kind === "barn") l = [0, p.H - 0.5, -p.D / 4];
    else if (p.kind === "shed") l = [0, p.H - 0.35, 0];
    if (!l) continue; // ruin/tower have no roof to hang from
    const cos = Math.cos(s.rot);
    const sin = Math.sin(s.rot);
    out.push({
      x: cos * l[0] + sin * l[2] + s.x,
      y: s.y + l[1],
      z: -sin * l[0] + cos * l[2] + s.z,
    });
  }
  return out;
}

export function createLanterns(structures) {
  const list = lanternLayout(structures);
  const group = new THREE.Group();
  const dark = [];
  const glow = [];
  const box = (arr, w, h, d, x, y, z) =>
    arr.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  for (const L of list) {
    box(dark, 0.02, 0.18, 0.02, L.x, L.y + 0.21, L.z); // hanging rod
    box(dark, 0.14, 0.02, 0.14, L.x, L.y + 0.11, L.z); // top cap
    box(dark, 0.12, 0.02, 0.12, L.x, L.y - 0.12, L.z); // bottom cap
    for (const sx of [-0.05, 0.05])
      for (const sz of [-0.05, 0.05])
        box(dark, 0.015, 0.22, 0.015, L.x + sx, L.y, L.z + sz); // cage posts
    box(glow, 0.07, 0.13, 0.07, L.x, L.y, L.z); // glass core
  }
  const cage = new THREE.Mesh(
    mergeGeometries(dark),
    new THREE.MeshStandardMaterial({
      color: 0x2a2d31,
      roughness: 0.6,
      metalness: 0.4,
    }),
  );
  const glass = new THREE.Mesh(
    mergeGeometries(glow),
    new THREE.MeshStandardMaterial({
      color: 0xffc97a,
      emissive: 0xffb866,
      emissiveIntensity: 2.1, // under the 2.6 bloom threshold
    }),
  );
  group.add(cage, glass);

  const lights = [
    new THREE.PointLight(0xffb066, 9, 9, 1.6),
    new THREE.PointLight(0xffb066, 9, 9, 1.6),
  ];
  for (const l of lights) group.add(l);

  // park the two shared lights at the nearest lanterns
  const update = (p) => {
    const near = list
      .map((L) => ({ L, d: (L.x - p.x) ** 2 + (L.z - p.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    lights.forEach((l, i) => {
      const L = (near[i] ?? near[0]).L;
      l.position.set(L.x, L.y - 0.06, L.z);
    });
  };
  if (list.length) update({ x: 0, z: 0 });
  return { group, list, update };
}

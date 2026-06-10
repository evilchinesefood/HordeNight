import * as THREE from "three";
import { Mulberry } from "../Core/Rng.js";

const MAT = {
  log: new THREE.MeshStandardMaterial({ color: 0x7c5a3c, roughness: 1 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 1 }),
  barn: new THREE.MeshStandardMaterial({ color: 0x80392c, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x9c7e54, roughness: 1 }),
};

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
  geo.computeVertexNormals();
  return geo;
}

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cabin() {
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

function barn() {
  const g = new THREE.Group();
  g.add(box(7, 3.6, 10, MAT.barn, 0, 1.8, 0));
  const roof = new THREE.Mesh(gableGeo(8, 2.6, 10.8), MAT.roof);
  roof.position.y = 3.6;
  g.add(roof);
  g.add(box(2.6, 2.9, 0.14, MAT.dark, 0, 1.45, 5.04));
  g.add(box(0.9, 0.9, 0.14, MAT.dark, 0, 4.1, 5.04));
  return { group: g, solids: [{ w: 7, h: 6.2, d: 10 }] };
}

function ruin(seed) {
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

function tower() {
  const g = new THREE.Group();
  const solids = [];
  for (const [lx, lz] of [
    [-1.1, -1.1],
    [1.1, -1.1],
    [-1.1, 1.1],
    [1.1, 1.1],
  ]) {
    g.add(box(0.3, 4.8, 0.3, MAT.wood, lx, 2.4, lz));
    solids.push({ w: 0.3, h: 4.8, d: 0.3, x: lx, z: lz });
  }
  g.add(box(3.2, 0.25, 3.2, MAT.wood, 0, 4.9, 0));
  for (const [rx, rz, w, d] of [
    [0, -1.55, 3.2, 0.1],
    [0, 1.55, 3.2, 0.1],
    [-1.55, 0, 0.1, 3.2],
    [1.55, 0, 0.1, 3.2],
  ]) {
    g.add(box(w, 0.9, d, MAT.wood, rx, 5.5, rz));
  }
  const roof = new THREE.Mesh(gableGeo(3.6, 1.1, 3.6), MAT.roof);
  roof.position.y = 6;
  g.add(roof);
  return { group: g, solids };
}

const BUILDERS = { cabin, barn, ruin, tower };

export function createBuildings(hf) {
  const group = new THREE.Group();
  const colliders = [];
  const v = new THREE.Vector3();

  hf.sites.forEach((site, i) => {
    const { group: g, solids } = BUILDERS[site.type](hf.seed + i * 13);
    g.position.set(site.x, site.y - 0.06, site.z);
    g.rotation.y = site.rot;
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(g);
    g.updateMatrixWorld(true);

    for (const s of solids) {
      // local solid center -> world (rotation is a multiple of 90°, AABB stays valid)
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

  return { group, colliders };
}

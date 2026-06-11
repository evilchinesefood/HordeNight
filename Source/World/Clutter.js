import * as THREE from "three";
import { HALF } from "../Core/Heightfield.js";
import { rockSurfaceSet } from "../Engine/Textures.js";
import { clutterLayout } from "../Core/Placement.js";

// rocks are bucketed into a coarse grid: one world-spanning InstancedMesh can
// never be frustum-culled, 9 regional ones cull fine for ~no extra draws
const REGIONS = 3;

// position-hashed radial jitter keeps the non-indexed icosahedron crack-free
function rockGeo() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const hash = (x, y, z) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const f =
      0.72 +
      0.5 *
        hash(
          Math.round(x * 100) / 100,
          Math.round(y * 100) / 100,
          Math.round(z * 100) / 100,
        );
    p.setXYZ(i, x * f, y * f * 0.65, z * f);
  }
  geo.computeVertexNormals(); // faceted: non-indexed keeps hard edges
  return geo;
}

export function createClutter(hf, buildingBoxes = []) {
  const group = new THREE.Group();
  // every placement decision (and RNG draw) lives in Core/Placement.js
  const { rocks, logs, circles } = clutterLayout(hf, buildingBoxes);
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const col = new THREE.Color();

  const rockTex = rockSurfaceSet(hf.seed + 61);
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockTex.map,
    normalMap: rockTex.nor,
    roughness: 0.95,
  });
  const geo = rockGeo();
  const cell = (HALF * 2) / REGIONS;
  const buckets = Array.from({ length: REGIONS * REGIONS }, () => []);
  for (const r of rocks) {
    const cx = Math.min(REGIONS - 1, ((r.x + HALF) / cell) | 0);
    const cz = Math.min(REGIONS - 1, ((r.z + HALF) / cell) | 0);
    buckets[cx * REGIONS + cz].push(r);
  }
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const mesh = new THREE.InstancedMesh(geo, rockMat, bucket.length);
    bucket.forEach((r, j) => {
      m.makeRotationFromEuler(e.set(r.rx, r.ry, r.rz));
      m.scale(v.set(r.s, r.s, r.s));
      m.setPosition(r.x, r.y - 0.18 * r.s, r.z);
      mesh.setMatrixAt(j, m);
      mesh.setColorAt(j, col.setRGB(r.cr, r.cg, r.cb));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- fallen logs ---
  const logGeo = new THREE.CylinderGeometry(0.26, 0.34, 1, 7)
    .rotateZ(Math.PI / 2)
    .translate(0, 0.26, 0);
  const logMat = new THREE.MeshStandardMaterial({
    color: 0x5f4a35,
    roughness: 1,
  });
  const logMesh = new THREE.InstancedMesh(logGeo, logMat, logs.length);
  logs.forEach((l, i) => {
    m.makeRotationFromEuler(e.set(0, l.a, l.tilt));
    m.scale(v.set(l.L, 1, 1));
    m.setPosition(l.x, l.y - 0.06, l.z);
    logMesh.setMatrixAt(i, m);
  });
  logMesh.castShadow = true;
  logMesh.receiveShadow = true;
  group.add(logMesh);

  return { group, circles };
}

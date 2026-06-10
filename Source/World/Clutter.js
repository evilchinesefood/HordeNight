import * as THREE from "three";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";

const ROCK_COUNT = 320;
const LOG_COUNT = 16;

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

export function createClutter(hf) {
  const rng = Mulberry(hf.seed + 67);
  const group = new THREE.Group();
  const circles = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const col = new THREE.Color();

  const slopeAt = (x, z) =>
    Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z)) +
    Math.abs(hf.heightAt(x, z + 2) - hf.heightAt(x, z - 2));

  // --- rocks: denser on steep/rocky ground, a few on the banks ---
  const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const rocks = new THREE.InstancedMesh(rockGeo(), rockMat, ROCK_COUNT);
  let placed = 0;
  for (let i = 0; i < ROCK_COUNT * 8 && placed < ROCK_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y - 0.4) continue;
    const steep = slopeAt(x, z) > 1.6;
    if (!steep && rng() > 0.3) continue;
    if (hf.sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 7 ** 2))
      continue;
    const s = 0.25 + rng() * rng() * 1.5;
    m.makeRotationFromEuler(
      e.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5),
    );
    m.scale(new THREE.Vector3(s, s, s));
    m.setPosition(x, y - 0.18 * s, z);
    rocks.setMatrixAt(placed, m);
    const g = 0.42 + rng() * 0.26;
    rocks.setColorAt(
      placed,
      col.setRGB(g * (1 + rng() * 0.08), g, g * (0.94 + rng() * 0.06)),
    );
    if (s > 0.6) circles.push({ x, z, r: 0.8 * s, topY: y + 0.7 * s });
    placed++;
  }
  rocks.count = placed;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);

  // --- fallen logs ---
  const logGeo = new THREE.CylinderGeometry(0.26, 0.34, 1, 7)
    .rotateZ(Math.PI / 2)
    .translate(0, 0.26, 0);
  const logMat = new THREE.MeshStandardMaterial({
    color: 0x5f4a35,
    roughness: 1,
  });
  const logs = new THREE.InstancedMesh(logGeo, logMat, LOG_COUNT);
  let lp = 0;
  for (let i = 0; i < LOG_COUNT * 30 && lp < LOG_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 16);
    const z = (rng() * 2 - 1) * (HALF - 16);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.5 || slopeAt(x, z) > 1.2) continue;
    if (hf.sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 11 ** 2))
      continue;
    const L = 2.6 + rng() * 2;
    const a = rng() * Math.PI * 2;
    m.makeRotationFromEuler(e.set(0, a, (rng() - 0.5) * 0.1));
    m.scale(new THREE.Vector3(L, 1, 1));
    m.setPosition(x, y - 0.06, z);
    logs.setMatrixAt(lp, m);
    for (const t of [-0.32, 0, 0.32]) {
      circles.push({
        x: x + Math.cos(a) * t * L,
        z: z - Math.sin(a) * t * L,
        r: 0.42,
        topY: y + 0.55,
      });
    }
    lp++;
  }
  logs.count = lp;
  logs.castShadow = true;
  logs.receiveShadow = true;
  group.add(logs);

  return { group, circles };
}

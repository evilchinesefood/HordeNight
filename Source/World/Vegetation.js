import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";
import { grassBladeTexture } from "../Engine/Textures.js";

const TREE_TRIES = 2600;
const GRASS_COUNT = 7000;
const SHRUB_COUNT = 280;

function pineGeo() {
  const cones = [
    new THREE.ConeGeometry(1.5, 2.3, 7).translate(0, 2.6, 0),
    new THREE.ConeGeometry(1.15, 2, 7).translate(0, 3.8, 0),
    new THREE.ConeGeometry(0.75, 1.7, 7).translate(0, 4.9, 0),
  ];
  return mergeGeometries(cones);
}

function oakCanopyGeo() {
  const blobs = [
    new THREE.IcosahedronGeometry(1.8, 1)
      .scale(1, 0.78, 1)
      .translate(0, 3.6, 0),
    new THREE.IcosahedronGeometry(1.1, 1).translate(1.1, 3, 0.4),
    new THREE.IcosahedronGeometry(0.95, 1).translate(-0.9, 3.1, -0.5),
  ];
  return mergeGeometries(blobs);
}

function scatterMatrix(rng, x, y, z, s, m) {
  m.makeRotationY(rng() * Math.PI * 2);
  m.scale(new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s));
  m.setPosition(x, y, z);
  return m;
}

export function createVegetation(hf) {
  const rng = Mulberry(hf.seed + 31);
  const group = new THREE.Group();
  const trunkColliders = [];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();

  const clearOfSites = (x, z, pad) =>
    hf.sites.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > pad * pad);

  // --- trees (poisson-ish via cell hash) ---
  const pines = [];
  const oaks = [];
  const cells = new Set();
  for (let i = 0; i < TREE_TRIES; i++) {
    const x = (rng() * 2 - 1) * (HALF - 12);
    const z = (rng() * 2 - 1) * (HALF - 12);
    const key = `${(x / 5) | 0},${(z / 5) | 0}`;
    if (cells.has(key)) continue;
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.8) continue;
    const slope = Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z));
    if (slope > 1.7) continue;
    if (!clearOfSites(x, z, 13)) continue;
    cells.add(key);
    (rng() < 0.55 ? pines : oaks).push({ x, y, z, s: 0.75 + rng() * 0.75 });
  }

  // foliage hue lives in per-instance colors, so those materials stay white
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6e5138,
    roughness: 1,
  });
  const pineMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const oakMat = new THREE.MeshStandardMaterial({ roughness: 1 });

  const addInstanced = (geo, mat, items, tintA, tintB) => {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((t, i) => {
      mesh.setMatrixAt(
        i,
        scatterMatrix(Mulberry(i * 7 + hf.seed), t.x, t.y - 0.15, t.z, t.s, m),
      );
      if (tintA)
        mesh.setColorAt(
          i,
          col.set(tintA).lerp(new THREE.Color(tintB), (i * 0.37) % 1),
        );
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  addInstanced(
    new THREE.CylinderGeometry(0.14, 0.3, 2.7, 6).translate(0, 1.35, 0),
    trunkMat,
    pines,
  );
  addInstanced(pineGeo(), pineMat, pines, 0x2e5230, 0x3c6b38);
  addInstanced(
    new THREE.CylinderGeometry(0.2, 0.36, 3, 6).translate(0, 1.5, 0),
    trunkMat,
    oaks,
  );
  addInstanced(oakCanopyGeo(), oakMat, oaks, 0x4a7032, 0x5d8438);

  for (const t of [...pines, ...oaks]) {
    trunkColliders.push({
      x: t.x,
      z: t.z,
      r: 0.4 * t.s + 0.1,
      topY: t.y + 3 * t.s,
    });
  }

  // --- grass tufts (two crossed alpha-tested quads, shader wind sway) ---
  const quad = new THREE.PlaneGeometry(1, 0.8).translate(0, 0.36, 0);
  const grassGeo = mergeGeometries([quad, quad.clone().rotateY(Math.PI / 2)]);
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const windUniform = { value: 0 };
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float wPhase = instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.35;
        float wBend = uv.y * uv.y;
        transformed.x += sin(uTime * 1.7 + wPhase) * wBend * 0.13;
        transformed.z += cos(uTime * 1.2 + wPhase) * wBend * 0.09;`,
      );
  };

  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  let placed = 0;
  for (let i = 0; i < GRASS_COUNT * 4 && placed < GRASS_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.35) continue;
    if (!clearOfSites(x, z, 8)) continue;
    grass.setMatrixAt(
      placed,
      scatterMatrix(rng, x, y, z, 0.7 + rng() * 0.9, m),
    );
    grass.setColorAt(
      placed,
      col.setHSL(0.24 + rng() * 0.05, 0.5, 0.5 + rng() * 0.22),
    );
    placed++;
  }
  grass.count = placed;
  grass.receiveShadow = true;
  group.add(grass);

  // --- shrubs ---
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1)
    .scale(1.2, 0.75, 1.2)
    .translate(0, 0.32, 0);
  const shrubMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_COUNT);
  let sp = 0;
  for (let i = 0; i < SHRUB_COUNT * 5 && sp < SHRUB_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.4) continue;
    if (!clearOfSites(x, z, 9)) continue;
    shrubs.setMatrixAt(sp, scatterMatrix(rng, x, y, z, 0.6 + rng() * 1.1, m));
    shrubs.setColorAt(
      sp,
      col.setHSL(0.25 + rng() * 0.04, 0.42, 0.3 + rng() * 0.12),
    );
    sp++;
  }
  shrubs.count = sp;
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  group.add(shrubs);

  const update = (t) => {
    windUniform.value = t;
  };
  return { group, trunkColliders, update };
}

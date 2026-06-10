import * as THREE from "three";
import { WORLD_SIZE, WATER_Y } from "../Core/Heightfield.js";
import { Fbm2 } from "../Core/Noise.js";
import { detailTexture } from "../Engine/Textures.js";

const RES = 256;

const GRASS_A = [0.36, 0.5, 0.21];
const GRASS_B = [0.25, 0.4, 0.18];
const DIRT = [0.43, 0.34, 0.23];
const ROCK = [0.5, 0.49, 0.47];
const BED = [0.3, 0.26, 0.2];

const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export function createTerrain(hf) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RES, RES);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const tint = Fbm2(hf.seed + 55);
  const normal = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = normal.getY(i);

    let c = lerp3(GRASS_A, GRASS_B, tint(x * 0.03, z * 0.03, 3) * 0.5 + 0.5);
    if (y > 11) c = lerp3(c, ROCK, clamp01((y - 11) / 6) * 0.6);
    c = lerp3(c, ROCK, clamp01((0.78 - ny) / 0.2)); // steep slopes
    if (y < WATER_Y + 0.7)
      c = lerp3(c, DIRT, clamp01((WATER_Y + 0.7 - y) / 0.7));
    if (y < WATER_Y) c = lerp3(c, BED, clamp01((WATER_Y - y) / 1.2));

    const shade = 0.92 + (tint(x * 0.35, z * 0.35, 2) * 0.5 + 0.5) * 0.16;
    colors[i * 3] = c[0] * shade;
    colors[i * 3 + 1] = c[1] * shade;
    colors[i * 3 + 2] = c[2] * shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailTexture(hf.seed),
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

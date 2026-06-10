import * as THREE from "three";
import { WORLD_SIZE, WATER_Y } from "../Core/Heightfield.js";
import { waterNormalTexture } from "../Engine/Textures.js";

export function createWater() {
  const tex = waterNormalTexture();
  tex.repeat.set(50, 50);
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a7a92,
    transparent: true,
    opacity: 0.72,
    roughness: 0.15,
    metalness: 0.05,
    normalMap: tex,
    normalScale: new THREE.Vector2(0.4, 0.4),
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true;

  const update = (dt) => {
    tex.offset.y -= dt * 0.045; // gentle downstream drift
    tex.offset.x += dt * 0.012;
  };
  return { mesh, update };
}

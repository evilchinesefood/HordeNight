import * as THREE from "three";
import { makeHeightfield } from "./Core/Heightfield.js";
import { Input } from "./Engine/Input.js";
import { createSky } from "./Engine/Sky.js";
import { createTerrain } from "./World/Terrain.js";
import { createWater } from "./World/Water.js";
import { createVegetation } from "./World/Vegetation.js";
import { createBuildings } from "./World/Buildings.js";
import { AudioAmbience } from "./World/AudioAmbience.js";
import { Player } from "./Player/Player.js";

const SEED = 7;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.66;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.1,
  900,
);

const hf = makeHeightfield(SEED);
const sky = createSky(scene);
scene.add(createTerrain(hf));
const water = createWater();
scene.add(water.mesh);
const veg = createVegetation(hf);
scene.add(veg.group);
const buildings = createBuildings(hf);
scene.add(buildings.group);

const input = new Input(renderer.domElement);
const audio = new AudioAmbience();

// spawn near the first cabin, facing the world center
const home = hf.sites[0] ?? { x: 0, z: 0 };
const spawn = {
  x: home.x + 10,
  z: home.z + 10,
  yaw: Math.atan2(home.x + 10, home.z + 10),
};
const player = new Player(
  camera,
  input,
  hf,
  buildings.colliders,
  veg.trunkColliders,
  spawn,
);

const overlay = document.getElementById("Overlay");
overlay.addEventListener("click", () => {
  audio.start();
  input.lock();
});
input.onLockChange = (locked) => overlay.classList.toggle("Hidden", locked);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  if (input.locked) player.update(dt);
  water.update(dt);
  veg.update(elapsed);
  sky.update(player.pos);
  audio.update(dt, hf.streamDist(player.pos.x, player.pos.z));
  renderer.render(scene, camera);
});

// debug handle for automated smoke tests
window.HN = { player, hf, scene, renderer, camera };

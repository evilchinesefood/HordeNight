import * as THREE from "three";
import { makeHeightfield } from "./Core/Heightfield.js";
import { Input } from "./Engine/Input.js";
import { createSky } from "./Engine/Sky.js";
import { createPostFx } from "./Engine/PostFx.js";
import { createTerrain } from "./World/Terrain.js";
import { createWater } from "./World/Water.js";
import { createVegetation } from "./World/Vegetation.js";
import { createBuildings } from "./World/Buildings.js";
import { createClutter } from "./World/Clutter.js";
import { AudioAmbience } from "./World/AudioAmbience.js";
import { Player } from "./Player/Player.js";

const SEED = 7;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.74;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.1,
  900,
);
camera.layers.enable(1); // clouds

const hf = makeHeightfield(SEED);
const sky = createSky(scene);
const terrain = createTerrain(
  hf,
  Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
);
scene.add(terrain.mesh);
const water = createWater(terrain.heightTex);
scene.add(water.mesh);
const veg = createVegetation(hf, terrain.heightTex);
scene.add(veg.group);
const buildings = createBuildings(hf);
scene.add(buildings.group);
const clutter = createClutter(hf);
scene.add(clutter.group);

const postFx = createPostFx(renderer, scene, camera, {
  ao: !location.search.includes("noao"),
});
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
  [...veg.trunkColliders, ...clutter.circles],
  spawn,
);

const overlay = document.getElementById("Overlay");
overlay.addEventListener("click", () => {
  audio.start();
  input.lock();
});
let statsHud = null;
if (location.search.includes("debug")) {
  overlay.classList.add("Hidden");
  statsHud = document.createElement("div");
  statsHud.style.cssText =
    "position:fixed;top:8px;left:8px;color:#7f7;font:13px monospace;" +
    "background:rgba(0,0,0,.65);padding:6px 9px;z-index:99;white-space:pre";
  document.body.appendChild(statsHud);
  renderer.info.autoReset = false;
  let frames = 0;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
    const i = renderer.info;
    statsHud.textContent =
      `fps   ${fps.toFixed(0)}\n` +
      `calls ${i.render.calls}\n` +
      `tris  ${(i.render.triangles / 1e6).toFixed(2)}M\n` +
      `tex   ${i.memory.textures} geo ${i.memory.geometries}`;
  }, 1000);
  statsHud.tick = () => frames++;
}
input.onLockChange = (locked) => overlay.classList.toggle("Hidden", locked);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postFx.setSize(window.innerWidth, window.innerHeight);
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
  terrain.update(elapsed);
  veg.update(elapsed, player.pos);
  sky.update(player.pos, elapsed);
  audio.update(dt, hf.streamDist(player.pos.x, player.pos.z));
  if (statsHud) {
    renderer.info.reset();
    statsHud.tick();
  }
  postFx.render();
});

// debug handle for automated smoke tests
window.HN = { player, hf, scene, renderer, camera };

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
import { Weather } from "./World/Weather.js";
import { Player } from "./Player/Player.js";

const SEED = 7;

const hintEl = document.querySelector("#Overlay .Hint");
const setHint = (t) => hintEl && (hintEl.textContent = t);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  setHint(
    "WebGL 2 is required - enable hardware acceleration or update your browser.",
  );
  throw err;
}
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); // allow restoration
  document.getElementById("Overlay").classList.remove("Hidden");
  setHint("Graphics device lost - recovering\u2026");
});
renderer.domElement.addEventListener("webglcontextrestored", () =>
  location.reload(),
);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // re-rendered only when the frustum moves
renderer.shadowMap.needsUpdate = true;
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
camera.layers.enable(2); // AO-excluded world meshes (grass, water)

setHint("Generating world\u2026");
await new Promise((r) => setTimeout(r)); // let the overlay paint before the heavy work

const hf = makeHeightfield(SEED);
const sky = createSky(scene);
const terrain = createTerrain(
  hf,
  Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
);
scene.add(terrain.mesh);
const water = createWater(terrain.heightTex);
scene.add(water.mesh);
await new Promise((r) => setTimeout(r));
const veg = createVegetation(hf, terrain.heightTex, renderer, sky.sunDir);
scene.add(veg.group);
await new Promise((r) => setTimeout(r));
const buildings = createBuildings(hf);
scene.add(buildings.group);
const clutter = createClutter(hf);
scene.add(clutter.group);

const postFx = createPostFx(renderer, scene, camera, {
  ao: !location.search.includes("noao"),
});
const input = new Input(renderer.domElement);
const audio = new AudioAmbience();
const weather = new Weather(scene, sky.sun, scene.fog, renderer);
weather.setOvercast = sky.setOvercast;

// dev menu: force day/night/rain for testing (visible while unpaused)
const devMenu = document.createElement("div");
devMenu.style.cssText =
  "position:fixed;bottom:10px;left:10px;z-index:1000;display:flex;gap:6px;" +
  "font:12px monospace";
const devBtn = (label, fn) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    "background:rgba(0,0,0,.7);color:#cde;border:1px solid #567;" +
    "padding:5px 10px;cursor:pointer";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    fn(b);
  });
  devMenu.appendChild(b);
  return b;
};
devBtn("Day", () => {
  weather.baseSun = sky.setNight(false);
  renderer.shadowMap.needsUpdate = true;
});
devBtn("Night", () => {
  weather.baseSun = sky.setNight(true);
  renderer.shadowMap.needsUpdate = true;
});
devBtn("Rain: auto", (b) => {
  weather.force = weather.force === null ? 1 : weather.force === 1 ? 0 : null;
  b.textContent =
    weather.force === null
      ? "Rain: auto"
      : weather.force
        ? "Rain: on"
        : "Rain: off";
});
document.body.appendChild(devMenu);

// spawn near the first cabin, facing the world center, on validated clear ground
const home = hf.sites[0] ?? { x: 0, z: 0 };
const worldCircles = [
  ...veg.trunkColliders,
  ...clutter.circles,
  ...buildings.circles,
];
const spawnClear = (x, z) =>
  hf.heightAt(x, z) > 0.5 &&
  !worldCircles.some(
    (c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1.2) ** 2,
  ) &&
  !buildings.colliders.some(
    (b) => x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1,
  );
let spawnX = home.x + 10;
let spawnZ = home.z + 10;
outer: for (let rad = 10; rad <= 26; rad += 4) {
  for (let a = 0; a < 12; a++) {
    const x = home.x + Math.cos((a / 12) * Math.PI * 2) * rad;
    const z = home.z + Math.sin((a / 12) * Math.PI * 2) * rad;
    if (spawnClear(x, z)) {
      spawnX = x;
      spawnZ = z;
      break outer;
    }
  }
}
const spawn = { x: spawnX, z: spawnZ, yaw: Math.atan2(spawnX, spawnZ) };
const player = new Player(
  camera,
  input,
  hf,
  buildings.colliders,
  worldCircles,
  spawn,
  {
    onStep: (sprint) => audio.step(sprint),
    onLand: (speed) => audio.land(speed),
  },
);

const overlay = document.getElementById("Overlay");
const desktop = "requestPointerLock" in document.body;
setHint(
  desktop
    ? "Click to explore"
    : "HordeNight needs a mouse + keyboard - open it on a desktop",
);
overlay.addEventListener("click", () => {
  if (!desktop) return;
  input.lock();
  audio.start();
});
let everLocked = false;
document.addEventListener("visibilitychange", () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.ctx.resume();
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
  let hudLast = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = (frames * 1000) / (now - hudLast);
    frames = 0;
    hudLast = now;
    const i = renderer.info;
    statsHud.textContent =
      `fps   ${fps.toFixed(0)}\n` +
      `calls ${i.render.calls}\n` +
      `tris  ${(i.render.triangles / 1e6).toFixed(2)}M\n` +
      `tex   ${i.memory.textures} geo ${i.memory.geometries}`;
  }, 1000);
  statsHud.tick = () => frames++;
  // overlay is hidden in debug mode; the canvas becomes the lock target
  renderer.domElement.addEventListener("click", () => {
    input.lock();
    audio.start();
  });
}
input.onLockChange = (locked) => {
  overlay.classList.toggle("Hidden", locked);
  devMenu.style.display = locked ? "none" : "flex";
  if (locked) everLocked = true;
  else if (everLocked)
    setHint("Paused - click to resume \u00b7 Esc releases the mouse");
};

window.addEventListener("resize", () => {
  const pr = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pr);
  postFx.setPixelRatio(pr);
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
  weather.update(dt, player.pos);
  water.update(dt);
  terrain.update(elapsed);
  veg.update(elapsed, player.pos, weather.gust);
  if (sky.update(player.pos, elapsed)) renderer.shadowMap.needsUpdate = true;
  audio.update(dt, hf.streamDist(player.pos.x, player.pos.z));
  if (statsHud) {
    renderer.info.reset();
    statsHud.tick();
  }
  postFx.render();
});

// debug handle for automated smoke tests
window.HN = { player, hf, scene, renderer, camera, veg, weather, sky };
const tp = new URLSearchParams(location.search).get("tp");
if (tp) {
  const [x, z, yaw, pitch] = tp.split(",").map(Number);
  player.pos.set(x, hf.heightAt(x, z), z);
  player.yaw = yaw || 0;
  player.pitch = pitch || 0;
  player.update(0);
}

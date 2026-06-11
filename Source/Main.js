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
import { Player, DT_MAX } from "./Player/Player.js";
import { setTextureAnisotropy } from "./Engine/Textures.js";
import { findSpawn } from "./Core/Placement.js";
import { Mulberry } from "./Core/Rng.js";
import { Zombies } from "./Entity/Zombies.js";
import { Game } from "./Game.js";
import { Hud } from "./Hud.js";
import { Inventory } from "./Items/Inventory.js";
import { LootContainers } from "./Items/LootContainers.js";
import { Combat } from "./Combat/Combat.js";
import { ViewModel } from "./Combat/ViewModel.js";
import { Particles } from "./Engine/Particles.js";

const SEED = 7;
const QS = new URLSearchParams(location.search);
const DEBUG = QS.has("debug");

const hintEl = document.querySelector("#Overlay .Hint");
const setHint = (t) => hintEl && (hintEl.textContent = t);

let renderer;
try {
  // antialias off: all scene rendering goes through the composer, whose
  // samples:2 target does the real AA - an MSAA backbuffer would only
  // multisample the final fullscreen quad (~80MB VRAM + a resolve, wasted)
  renderer = new THREE.WebGLRenderer({ antialias: false });
} catch (err) {
  setHint(
    "WebGL 2 is required - enable hardware acceleration or update your browser.",
  );
  throw err;
}
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); // allow restoration
  document.exitPointerLock?.(); // a locked pointer over a dead canvas traps the user
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
// AO-excluded world meshes (grass, water, foliage cards). LOAD-BEARING for
// shadows too: three tests shadow casters against THIS camera's layer mask
camera.layers.enable(2);
setTextureAnisotropy(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));

setHint("Generating world\u2026");
await new Promise((r) => setTimeout(r)); // let the overlay paint before the heavy work

const hf = makeHeightfield(SEED);
const sky = createSky(scene);
// async: the heavy attribute fill runs in TerrainWorker while textures
// generate here, and the overlay stays responsive during the await
const terrain = await createTerrain(
  hf,
  Math.min(renderer.capabilities.getMaxAnisotropy(), 8),
);
scene.add(terrain.mesh);
// placement reads the mesh's own lattice so objects seat on the rendered
// ground; the player keeps the analytic surface (identical at vertices)
const hfp = { ...hf, heightAt: terrain.gridHeightAt };
const water = createWater(terrain.heightTex);
scene.add(water.mesh);
await new Promise((r) => setTimeout(r));
const veg = createVegetation(hfp, terrain.heightTex, renderer, sky.sunDir);
scene.add(veg.group);
await new Promise((r) => setTimeout(r));
const buildings = createBuildings(hfp);
scene.add(buildings.group);
const clutter = createClutter(hfp, buildings.colliders);
scene.add(clutter.group);
const loot = new LootContainers({
  heightAt: terrain.gridHeightAt,
  structures: buildings.structures,
  barrels: buildings.props.barrels,
  seed: SEED,
});
scene.add(loot.group);
// crates/cabinets block movement alongside the building walls
const colliderBoxes = buildings.colliders.concat(loot.boxes());

// the world never moves after assembly: freeze matrices so the 600+ static
// objects skip recomposition in every render (beauty + GTAO pre-pass)
scene.updateMatrixWorld(true);
for (const root of [
  terrain.mesh,
  water.mesh,
  veg.group,
  buildings.group,
  clutter.group,
  loot.group,
])
  root.traverse((o) => (o.matrixAutoUpdate = false));

const postFx = createPostFx(renderer, scene, camera, {
  ao: !QS.has("noao"),
  bloom: !QS.has("nobloom"),
});
const input = new Input(renderer.domElement);
const audio = new AudioAmbience();
const weather = new Weather(
  scene,
  sky.sun,
  scene.fog,
  renderer,
  SEED,
  sky.setOvercast,
);

// spawn near the first cabin, facing the world center, on validated clear ground
const worldCircles = [
  ...veg.trunkColliders,
  ...clutter.circles,
  ...buildings.circles,
];
const spawn = findSpawn(hfp, worldCircles, colliderBoxes);
const player = new Player(
  camera,
  input,
  hf,
  colliderBoxes,
  worldCircles,
  spawn,
  {
    onStep: (sprint) => audio.step(sprint),
    onLand: (speed) => audio.land(speed),
  },
);

const hud = new Hud();
const zombies = new Zombies({
  heightAt: terrain.gridHeightAt,
  hf: hfp,
  boxes: colliderBoxes,
  circles: worldCircles,
  rng: Mulberry(SEED * 7919 + 1), // own stream: world draws stay untouched
});
scene.add(zombies.group);
scene.add(camera); // the first-person viewmodel hangs off the camera
const inventory = new Inventory(); // bat only - guns come from loot
const viewModel = new ViewModel(camera);
const particles = new Particles(scene, terrain.gridHeightAt);
const combat = new Combat({
  camera,
  player,
  zombies,
  inventory,
  viewModel,
  hud,
  audio,
  particles,
  rng: Mulberry(SEED * 131 + 7),
});
const game = new Game(
  {
    player,
    zombies,
    weather,
    water,
    terrain,
    veg,
    sky,
    audio,
    hf,
    hud,
    input,
    inventory,
    combat,
    viewModel,
    loot,
    particles,
  },
  () => {
    hud.flashDeath();
    document.exitPointerLock?.();
    // M5 death screen replaces the M3 hard reload; restart is the button
    setTimeout(() => hud.showDeath(game.nightsSurvived, game.best), 900);
  },
);
document
  .getElementById("RestartBtn")
  .addEventListener("click", () => location.reload());

// dev menu (?debug only): force day/night/rain, spawn waves; shows while paused
let devMenu = null;
if (DEBUG) {
  devMenu = document.createElement("div");
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
      b.blur(); // keep Space/Enter on the pause screen from re-firing it
    });
    devMenu.appendChild(b);
    return b;
  };
  // jump the running cycle; its apply hook relights everything immediately
  devBtn("Day", () => game.dayNight.jump("DAY"));
  devBtn("Night", () => game.dayNight.jump("NIGHT"));
  const rainLabel = () =>
    weather.force === null
      ? "Rain: auto"
      : weather.force
        ? "Rain: on"
        : "Rain: off";
  devBtn(rainLabel(), (b) => {
    weather.force = weather.force === null ? 1 : weather.force === 1 ? 0 : null;
    b.textContent = rainLabel();
  });
  devBtn("Spawn wave", () => zombies.spawnWave(player, 8));
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyG") zombies.spawnWave(player, 8);
  });
  document.body.appendChild(devMenu);
}

const overlay = document.getElementById("Overlay");
// capability, not API presence: Android Chrome exposes requestPointerLock
// but has no fine pointer - those users need the desktop message
const desktop = matchMedia("(any-pointer: fine)").matches;
// compile every scene program while the overlay is still up so the first
// click doesn't hitch on 20+ synchronous shader compiles
await renderer.compileAsync(scene, camera).catch(() => {});
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
if (DEBUG) {
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
  if (devMenu) devMenu.style.display = locked ? "none" : "flex";
  if (locked) everLocked = true;
  else if (everLocked)
    setHint("Paused - click to resume \u00b7 Esc releases the mouse");
};

const applySize = () => {
  const pr = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pr);
  postFx.setPixelRatio(pr);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postFx.setSize(window.innerWidth, window.innerHeight);
};
window.addEventListener("resize", applySize);
// DPR can change with no resize event (window dragged between monitors);
// the matchMedia query matches the CURRENT dpr, so re-arm after each change
let dprWatch = null;
const onDprChange = () => {
  applySize();
  armDprWatch();
};
const armDprWatch = () => {
  if (dprWatch) dprWatch.removeEventListener("change", onDprChange);
  dprWatch = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprWatch.addEventListener("change", onDprChange);
};
armDprWatch();

// roofed footprints occlude the camera-local rain
const indoorNow = () =>
  buildings.interiors.some(
    (b) =>
      player.pos.x > b.minX &&
      player.pos.x < b.maxX &&
      player.pos.z > b.minZ &&
      player.pos.z < b.maxZ,
  );

let last = performance.now();
let lastDraw = 0;
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  // paused behind the translucent overlay: ~30fps is plenty (battery/thermal)
  if (!input.locked && !statsHud && now - lastDraw < 33) return;
  lastDraw = now;
  const dt = Math.min((now - last) / 1000, DT_MAX);
  last = now;
  elapsed += dt;
  const res = game.update(dt, elapsed, {
    locked: input.locked,
    indoor: indoorNow(),
  });
  if (res.shadowDirty) renderer.shadowMap.needsUpdate = true;
  if (statsHud) {
    renderer.info.reset();
    statsHud.tick();
  }
  postFx.render();
});

// debug handle for automated smoke tests
window.HN = {
  player,
  hf,
  scene,
  renderer,
  camera,
  veg,
  weather,
  sky,
  zombies,
  game,
  hud,
  combat,
  inventory,
  loot,
  input,
  particles,
};
const tp = QS.get("tp");
if (tp) {
  const [x, z, yaw, pitch, up] = tp.split(",").map(Number);
  // malformed values would NaN-poison the camera matrix with no recovery
  if (Number.isFinite(x) && Number.isFinite(z)) {
    player.pos.set(x, hf.heightAt(x, z) + (up || 0), z);
    player.yaw = yaw || 0;
    player.pitch = pitch || 0;
    player.update(0);
  }
}

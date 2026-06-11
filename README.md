# HordeNight

First-person 3D zombie-survival game (7 Days to Die-inspired) built with [Three.js](https://threejs.org/) and Vite. Loot by day, survive the horde by night — your score is nights survived.

## The loop

- **Day/night cycle** — a running clock (≈4-minute days, 2.5-minute nights) drives the sun below the horizon, moonlit nights, and the HUD clock. Days are calm looting windows with a few wanderers; at dusk the horde ramps up, scaling its numbers and speed with every night you survive; at dawn the survivors flee.
- **Zombies** — procedurally built 10-part rigs (no two builds alike) that spawn out of view, steer around trees and buildings, walk through doorways, ring you when they attack, and topple when killed. The whole horde renders in ~11 draw calls.
- **Combat** — bat, pistol, shotgun, and full-auto rifle with distinct handling, recoil, reload, and synthesized gunshot audio. Hold right-click to aim down the sights (FOV zoom, tighter spread). Hitscan with headshot multipliers, muzzle flash, blood/dust particles, and ejected casings. Melee runs on stamina.
- **Loot** — searchable crates, lockers, and barrels at every site ("Hold E"). You start with only the bat; guns, ammo, and bandages come from scavenging. Hotbar 1–4, ammo counters, Tab inventory.
- **Score** — dying shows nights survived and your best (persisted locally), then restart into a fresh run.

## What's in the world

- **Terrain** — seeded procedural heightfield (simplex FBM), rolling hills, vertex-color surface that shifts between grass, dirt, and rock by height and slope.
- **Stream** — a winding river carved into the terrain with animated, semi-transparent flowing water.
- **Vegetation** — ez-tree generated pines/oaks/ashes (full detail near, render-baked impostor cards far), shrubs, and 11k camera-following wind-swayed grass tufts; everything placed by slope/water/clearing rules.
- **Buildings** — hollow, walk-in cabins and a barn, lean-to sheds, stone ruins, and a watchtower on flattened pads, all with collision and a lantern glowing inside every roofed interior.
- **Atmosphere** — texel-snapped real-time shadows, scattering sky, distance fog with a warm in-scatter lobe toward the sun, drizzle cycles, and procedural WebAudio ambience (wind, birds, rain, water that swells near the stream).
- **Player** — first-person kinematic controller with sprint stamina, health, healing, and a flashlight; collides with buildings, trees, rocks, logs, fences, barrels, crates, and the well; low obstacles can be stepped or jumped onto.

The whole world is generated from one seed (`SEED` in `Source/Main.js`) — no model or texture assets; everything is code-built (canvas textures, box-rig characters and weapons, synthesized audio), except tree bark PBR maps which ship inside the ez-tree package.

## Controls

**WASD** move · **Mouse** look · **RMB** aim · **LMB** fire/swing · **R** reload · **1–4** weapons · **E** search · **Q** heal · **F** flashlight · **Tab** inventory · **Shift** sprint · **Space** jump

## Run

```sh
npm install
npm run dev      # dev server
npm run build    # production build -> dist/
npm run preview  # serve the build
npm test         # node unit tests (world gen, collision, sim, combat, loot)
npm run format   # prettier
```

Open the printed URL and click to lock the pointer. `?debug` adds a stats HUD, dev menu (day/night/rain/spawn wave), and skips the overlay.

## Layout

```
Source/
  Main.js            bootstrap: renderer, world assembly, frame loop
  Game.js            simulation sequencing, day/night ownership, score
  Hud.js             DOM HUD: bars, clock, hotbar, prompts, death screen
  Core/              pure logic, Node-testable (Rng, Noise, Heightfield, Placement)
  Engine/            Input, Collision, SpatialGrid, Particles, Sky, PostFx, Textures
  Systems/           DayNightCycle
  Entity/            zombie sim: Steering, Spawner, Zombie, Zombies, ZombieMesh
  Combat/            WeaponDB, hitscan resolution, first-person ViewModel
  Items/             Inventory, loot tables, searchable LootContainers
  World/             Terrain, Water, Vegetation, Buildings, Lanterns, Weather, AudioAmbience
  Player/            first-person kinematic controller
Tests/RunAll.js      unit tests
```

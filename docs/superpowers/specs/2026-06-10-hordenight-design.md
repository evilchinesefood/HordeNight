# HordeNight — Design Spec (v1 vertical slice)

**Date:** 2026-06-10
**Status:** Approved for planning
**Repo:** `evilchinesefood/HordeNight` · local `C:\Users\evilc\Github\HordeNight`

> Working title `HordeNight` — rename freely. ("Horde Night" is 7 Days to Die's term for a blood-moon attack.)

## 1. Concept

A first-person 3D zombie-survival game inspired by *7 Days to Die*. Loot buildings during the day, survive escalating zombie hordes at night. Endless run — the score is **nights survived**. No crafting in v1; the player manages **health** and **stamina** only.

The art direction is **low-poly (CC0 assets) made to look highly detailed through density and atmosphere** — many varied props, dynamic shadows, distance fog, a sky, light post-processing, and material/color variation — rather than high-poly photorealism.

## 2. Tech Stack & Conventions

- **Build:** Vite + `three` (npm). Bundled build.
- **Rendering:** Three.js `WebGLRenderer`, `PerspectiveCamera`, `PointerLockControls` (or equivalent first-person controls).
- **Assets:** Low-poly CC0 GLTF models (Quaternius zombies/weapons, Kenney prototype/props), preloaded by an `AssetLoader` before play. Textures kept small.
- **Physics:** No physics engine. A lightweight custom **kinematic character controller** + **AABB collision** against world colliders, plus raycasts for shooting/interaction. (`rapier`/`cannon-es` is a documented fallback if movement feel demands it — not a v1 dependency.)
- **File naming:** PascalCase for all files/dirs (`Game.js`, `WorldGen.js`, `Source/`), per project standards.
- **Formatting:** Prettier.
- **Source layout:** Modules under `Source/`. Mirrors the structure of EmojiSurvivors/IdleKingdom where reasonable.
- **Deploy:** Vite `base` configured for subpath. `npm run build` → `dist/` rsynced to `dev.jdayers.com/horde/`. Relative-path care for subpath hosting (per project memory on PWA subpath deploys).

## 3. Architecture

Modular system/manager pattern. `Game` owns shared state and the fixed-order `update(dt)` loop; systems are independent units with clear inputs/outputs.

### Engine layer
- **`Renderer`** — scene, camera, `WebGLRenderer`, lighting (directional sun + ambient/hemisphere), shadow maps, fog, skybox, and a post-processing composer (bloom, SSAO/vignette). Exposes `render()` and hooks for the day/night cycle to drive sun angle, ambient color, and fog.
- **`Input`** — pointer-lock mouse-look + WASD/keys; abstracts raw events into an input state (move vector, look delta, action flags: shoot, melee, reload, interact, jump, sprint).
- **`Collision`** — resolves the player capsule (approximated) against world AABB colliders; provides ground detection and raycast helpers (shoot ray, interact ray).

### World layer
- **`WorldGen`** — builds a **seeded procedural tile grid** (~8×8, each tile ~20m). Tile catalogue: `road`, `lot`, `building`, `ruin` (extensible). Each generated tile contributes: meshes (assembled from prefab pieces + scattered props), wall/obstacle **colliders**, and **loot-spawn points**. Map edge is bounded by invisible walls + fog. Player spawns near center. Determinism: same seed → same map (unit-tested).
- **`Tile` prefabs / `PropScatter`** — prefab assembly helpers and a density-driven prop scatterer (rubble, cars, fences, foliage, signage, debris) with per-instance color/rotation/scale variation so repeated prefabs don't read as copies. Uses instanced meshes where prop counts are high (perf).

### Entity layer
- **`Player`** — camera rig, kinematic movement (walk/sprint/jump, gravity, slide-along-wall), **health** + **stamina** (sprint/melee drain, regen), inventory, currently-equipped weapon, interaction.
- **`Zombie`** — mesh + simple **state machine**: `idle`/`wander` by day, `seek`→`attack` player by night. Steering toward the player with steer-and-slide obstacle avoidance against tile colliders (A* on the tile occupancy grid is a documented stretch, not v1). HP, melee contact damage.
- **`Spawner`** — spawns/recycles zombies; count and aggression scale with the night number; obeys day/night phase (sparse wanderers by day, horde at night, cleanup at dawn). Object-pooled.

### Items layer
- **`ItemDB`** — static item definitions: melee weapon, gun(s), ammo, bandage (heal). Each defines type, stats, model, stack rules.
- **`LootContainer`** — interactable in the world (raycast-to-open); rolls a small loot table into the player's inventory.
- **`Inventory`** — player inventory + hotbar; equip/select, stack/consume, ammo accounting.

### Combat layer
- **`Weapon`** — melee swing (arc + cooldown + stamina cost) and hitscan **gun** (raycast, damage, fire-rate, ammo, reload). Applies damage to zombies; handles hit feedback.

### Systems layer
- **`DayNightCycle`** — the heartbeat. A configurable clock (e.g. ~5 min day, then night). Drives `Renderer` lighting/fog transitions and gates `Spawner` behavior. On dawn: hostiles flee/despawn and `nightsSurvived++`.
- **`HUD`** — DOM/overlay UI: health + stamina bars, ammo count, day/night indicator + night counter, interaction prompts, inventory screen, death screen with **best score** (localStorage).

### State
- No save game in v1 (endless run restarts fresh). Only **best nights survived** persists in localStorage.

## 4. Data Flow

```
requestAnimationFrame
  -> Game.update(dt):
       Input.poll()
       Player.update(dt)        // movement resolved via Collision
       DayNightCycle.update(dt) // advances clock; pushes lighting to Renderer; sets phase
       Spawner.update(dt)       // spawns/recycles by phase + night number
       Zombie.update(dt) [each] // AI state machine + steer-and-slide via Collision
       Combat.resolve()         // player rays hit zombies; zombie contact hits player
       Loot/Interaction.resolve()
       HUD.sync(state)
  -> Renderer.render()
```

- **Input → Player:** movement, look, sprint, jump, shoot, melee, reload, interact.
- **DayNightCycle → Renderer + Spawner:** lighting/fog by time of day; spawn intensity by phase.
- **Combat:** player shoot/melee ray → zombie damage/death; zombie contact → player HP loss.
- **Loot:** interact ray → `LootContainer.open()` → items into `Inventory`.
- **Death:** HP ≤ 0 → death screen → record best score → restart.

## 5. Build Sequence (Milestones)

> **Milestone 1 is the priority deliverable:** a detailed, walkable world, standalone and fun to move around in, *before* any zombies/loot/combat.

1. **Detailed walkable world** *(priority)*
   - Vite + Three scaffold, build/deploy pipeline.
   - `Renderer` with sun + shadows, ambient/hemisphere light, fog, skybox, post-processing.
   - `AssetLoader` + initial CC0 prop/building/environment assets.
   - `WorldGen` procedural tile grid with dense, varied prop scatter (instanced) and colliders.
   - `Player` first-person kinematic controller (walk/sprint/jump/gravity) + `Collision`.
   - **Deliverable:** walk around an atmospheric, dense city block at a solid framerate with correct collision. No enemies.
2. **Day/night cycle** — `DayNightCycle` clock + smooth lighting/fog transitions; HUD time indicator.
3. **Zombies** — `Zombie` AI state machine, `Spawner`, day/night-gated behavior, object pooling.
4. **Combat** — `Weapon` melee + hitscan gun, damage/death, hit feedback, stamina costs.
5. **Loot, inventory, HUD, score** — `ItemDB`, `LootContainer`, `Inventory`/hotbar, full HUD, death screen + best-score persistence.

Each milestone is independently playable/testable and builds on the previous.

## 6. Testing

- **Node unit tests (no DOM)** for pure logic — mirrors the EmojiSurvivors `npm test` + `node --check` + Prettier workflow:
  - `WorldGen` determinism (same seed → identical tile layout & collider set).
  - `DayNightCycle` clock/phase transitions and night counting.
  - `Spawner` difficulty curve (counts/aggression by night number).
  - `Inventory` add/stack/consume/ammo math.
  - Combat damage math (weapon damage, HP depletion, death threshold).
- **Manual browser playtest checklist** for browser-only concerns (verified in-browser, not by automated test): movement feel, collision correctness, shooting feel, AI behavior/pathing, rendering/post-fx, framerate with high prop/zombie counts, day/night visual transitions.

Pure systems are designed DOM-free so they can be imported and tested in Node; rendering/input/UI sit behind thin adapters.

## 7. Out of Scope for v1 (future expansions)

Crafting / workbenches · base building / barricades / wall repair · hunger / thirst meters · third-person camera · multiple maps / biomes · save/load persistence (beyond best score) · audio/music polish · multiplayer · vehicles · skill/leveling trees.

## 8. Open Questions / Risks

- **Zombie navigation:** steer-and-slide may look dumb around complex building interiors; A* on the tile grid is the planned upgrade if needed.
- **Performance:** dense props + many zombies — rely on instancing, object pooling, frustum culling, and LOD/draw-distance fog. Validate early in Milestone 1.
- **Asset sourcing:** confirm a consistent CC0 set (Quaternius + Kenney) that share a visual style before heavy world building.
- **Movement feel:** custom kinematic controller is the risk point; `rapier` is the fallback if it feels bad.

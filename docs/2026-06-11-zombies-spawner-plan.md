# HordeNight — Zombies & Spawners (M3)

## Context

M1 (the explorable procedural valley) is done and polished; the world layer is wrapping up
in a separate window. The design spec's next milestone is **M3: zombies + spawner** (M2 day/night
is being deferred — see decisions). This plan adds hostile zombies that spawn near the player,
chase and avoid obstacles, deal contact damage, and can kill the player — the first real threat
loop. Combat (fighting back), loot, and the full HUD remain later milestones.

A second goal, chosen by the user, is to introduce the spec's deferred **`Game` object**: extract
the per-frame simulation loop and shared state out of `Main.js` into a `Game` manager that owns the
player and the entity system (and later day/night + score). This gives M4/M5 a clean home.

Two M3 prerequisites the spec flagged as "deferred architecture work" already exist and will be
reused (not rebuilt):
- `Source/Core/Placement.js` — `findSpawn(hf, circles, boxes)` returns `{x,z,yaw,clear}`; its inner
  clearance test is the pattern for validating zombie spawn points (above water, clear of
  circles+buildings). Collider shapes: boxes `{minX,maxX,minZ,maxZ,minY,maxY}`, circles `{x,z,r,topY}`.
- `Source/World/Terrain.js` — `createTerrain(...)` returns `gridHeightAt(x,z)`, a fast bilinear
  sampler over the rendered terrain lattice. Zombies ground-follow with this instead of the
  7-octave analytic `hf.heightAt`.

## Decisions (locked with user)

1. **Day/night: decoupled.** No running cycle yet — zombies are always hostile (seek/chase). Phase-gating is a later wire-up.
2. **Visuals: procedural low-poly.** Code-built boxy humanoids + code animation. No GLTF, no `AssetLoader` (consistent with M1's all-procedural pipeline).
3. **Scope: AI + movement + contact damage + player health.** Zombies chase and hurt you; you cannot fight back yet (no player weapon — that's M4). Zombies are not killable this step (they carry HP as a seam for M4).
4. **Spawner: population cap near player**, recycle when far + a `?debug` "spawn wave" burst button for stress-testing.
5. **Navigation: steer + whisker avoidance.** Seek vector toward player, short look-ahead feelers to veer around tree/building corners, separation so they don't stack.
6. **On death: hard restart.** Brief red death-flash, then `location.reload()` (fresh world). No score/game-over UI yet.

## Architecture

`Main.js` keeps all rendering/IO concerns it owns today (renderer + tuning, `postFx.render()`,
shadow-map flags, resize, pointer-lock, overlay, `?debug` stats HUD + dev menu, `?tp`, matrix
freezing, `window.HN`). The **simulation update sequence + state ownership** moves into `Game`.

### New files

- **`Source/Game.js`** — `Game` class. Constructed with the already-built world systems
  (`player, zombies, weather, water, terrain, veg, sky, audio`) + an `onDeath` callback. Owns the
  fixed-order `update(dt, elapsed, { locked, indoor })` that sequences:
  `player.update → zombies.update(dt, player) → weather → water → terrain → veg → sky → audio`,
  returning `{ shadowDirty }` (from `sky.update`) so Main can flag the shadow map. Watches
  `player.dead` and fires `onDeath`. This is the seam M4/M5 hang off.
- **`Source/Hud.js`** — minimal placeholder HUD: a health bar (bottom-center DOM) + a red
  damage/death flash overlay. `setHealth(frac)`, `flashDamage()`, `flashDeath()`. Full HUD is M5.
- **`Source/Engine/SpatialGrid.js`** — pure uniform-cell spatial hash. `makeGrid(cell)`,
  `insert(item, x, z)`, `queryRadius(x, z, r) -> items[]`. Built **once** from all static world
  colliders (buildings.colliders + clutter.circles + veg.trunkColliders). Lets each zombie query
  only nearby colliders (~1800 static colliders total → a handful per query) for steering/collision.
- **`Source/Entity/Steering.js`** — pure, unit-tested: `seek(zx,zz,px,pz,speed)`,
  `whiskerAvoid(x,z,dirx,dirz,nearby)` (look-ahead feelers vs boxes/circles → deflection),
  `separation(self, neighbors, r)`. Returns blended, normalized desired velocity.
- **`Source/Entity/Spawner.js`** — pure cap/cadence: `tick({active, cap, accum, dt, rate}) ->
  {spawns, accum}` and `pickSpawnPoint(px, pz, lookDir, rng, isClear)` (tries radii ~28–45m at
  angles biased out of view; returns first clear point or null). `isClear` is injected (reused
  Placement clearance predicate).
- **`Source/Entity/Zombie.js`** — pure per-zombie step: given state + player + nearby colliders +
  neighbors + dt → updated `{x,z,vx,vz,yaw,phase,state,attacked}`. Uses `Steering` + reuses
  `resolveCircleAabb`/`resolveCircleCircle` from `Collision.js` for hard obstacle resolution. States:
  `CHASE` (default, always hostile) → `ATTACK` (in contact range; emits a hit on cooldown). Testable.
- **`Source/Entity/ZombieMesh.js`** — browser-only rig. **6 `InstancedMesh` body parts** (torso,
  head, 2 arms, 2 legs), capacity = pool size → **~6 draw calls for all zombies**. Per active
  zombie, compute each part's matrix from walk `phase` (legs `sin`, arms outstretched + sway, torso
  lurch) and write to instance matrices; `attacked` lunges the arms. Per-instance color via
  `setColorAt` (greenish-gray, slight variation) — **material stays white** (M1 `setColorAt`
  gotcha). Plus an instanced **blob shadow** (dark ground circle under each).
  `castShadow=false, receiveShadow=true` — keeps `shadowMap.autoUpdate=false` intact (no per-frame
  shadow-map regen for moving casters); the blob fakes grounding. Real shadow-casting noted as a
  deferred option.
- **`Source/Entity/Zombies.js`** — orchestrator owned by `Game`. Holds the object pool
  (`MAX_POOL≈48`), the static `SpatialGrid`, the `ZombieMesh`, and the spawner state. `update(dt,
  player)`: run spawner (maintain `CAP≈24` active near player; recycle dist >~75m), step each active
  zombie (`Zombie.step`), brute-force O(n²) zombie–zombie separation (pool small), apply contact
  damage (`player.takeDamage` on in-range attack cooldowns), and write poses to `ZombieMesh`.
  Exposes `group`, `spawnWave(n)` (dev), and the active list for `window.HN.zombies`.

### Modified files

- **`Source/Player/Player.js`** — add `health`, `maxHealth` (100), `dead`, `takeDamage(d)`
  (clamps to 0, sets `dead`). Expose `RADIUS` (already exported) for contact range. No other
  movement changes.
- **`Source/Main.js`** — after world assembly, build `Hud`, `Zombies` (pass `terrain.gridHeightAt`,
  the static colliders, `hf`, a Mulberry stream), and `Game`; the animation loop becomes
  `game.update(...)` → flag shadow if dirty → `postFx.render()`; sync `Hud` from `player.health`;
  add a `?debug` "Spawn wave" dev-menu button + a key (e.g. `KeyG`) calling `zombies.spawnWave`;
  add `zombies`, `game` to `window.HN`. `onDeath` → `Hud.flashDeath()` then `location.reload()`.
- **`Index.html`** — add health-bar + damage-flash DOM + CSS (mirrors existing `#Overlay`/`.Hidden`
  inline-style approach).
- **`Source/Core/Placement.js`** — extract `findSpawn`'s inner `clear(x,z)` into an exported
  `isClearAt(hf, circles, boxes, x, z, pad)`; reuse it in both `findSpawn` and the zombie spawner.
- **`Tests/RunAll.js`** — add pure unit tests (mirrors the existing `test(...)` harness): SpatialGrid
  insert/queryRadius; Steering seek/whisker-deflection/separation; Spawner cap+cadence accumulator and
  `pickSpawnPoint` clearance; `Zombie.step` (chase shrinks distance; stops + flags attack in range;
  slides along an obstacle instead of clipping); contact-damage math + player death threshold;
  `Player.takeDamage`.

## Build sequence

1. `Player.takeDamage` + health fields (+ test).
2. `SpatialGrid` (+ test).
3. `Steering` pure math (+ tests).
4. `Spawner` + `Zombie` pure step (+ tests).
5. `ZombieMesh` instanced rig + blob shadows + procedural shamble animation (browser).
6. `Zombies` orchestrator (pool + grid + spawner + mesh + contact damage).
7. `Game` extraction from `Main.js`; rewire the loop; `Hud`; dev wave button/key; `window.HN`.
8. `Index.html` HUD DOM/CSS.
9. Prettier + `npm test` + browser verification.

## Verification

- **`npm test`** (Node units) green, including all new pure tests. Existing determinism tests must
  still pass (zombie sim is intentionally outside seed-determinism — spawn timing depends on player
  movement; document this).
- **Prettier** on `Source/**/*.js`, `Tests/**/*.js`, `Index.html` (project Golden Rule).
- **Build:** `npm run build` green (watch the SHELL/first-party module list if the build precaches
  modules — add new `Source/Entity/*` files if required, per the IdleKingdom-style SHELL rule the
  repo follows).
- **Browser (real GPU + headless probe)** via `window.HN.zombies` / `window.HN.game` using the
  repo's CDP/Playwright probe patterns (`~/HordeNight*.mjs`):
  - `?debug` "Spawn wave" → zombies appear out of view, shamble toward the player.
  - They slide around a cabin/barn and veer past trees (whisker avoidance), don't stack (separation).
  - Walking into the player drains the health bar; reaching a pack kills fast.
  - Health 0 → red flash → page reloads to a fresh world.
  - Draw calls stay near M1 levels (zombie rig ≈ 6–7 calls); framerate holds in a dense wave.

## Tunables / risks (defaults, easy to adjust)

- `CAP≈24` active, `MAX_POOL≈48`, spawn radius `28–45m`, recycle `>75m`, contact `~10 dmg` every
  `1.0s/zombie`, **no health regen** (placeholder hardness). All centralized as constants.
- Whisker avoidance can still wedge a zombie in a deep building corner (acceptable; most spawn in
  open valley). A* on the grid remains the spec's documented stretch if needed.
- Moving zombies + `shadowMap.autoUpdate=false`: handled via blob shadows (no per-frame shadow-map
  cost). Revisit real casters only if grounding looks weak.

## Out of scope (later milestones)

Player weapons / killing zombies (M4) · day/night gating of spawns (M2 wire-up) · loot/inventory ·
full HUD + score/best-night persistence + proper death screen (M5) · GLTF zombie models · A* pathfinding.

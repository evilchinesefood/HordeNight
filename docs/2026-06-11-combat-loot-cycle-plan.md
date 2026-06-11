# HordeNight — Day/Night Cycle, Combat, Loot, HUD & Score (M2 + M4 + M5)

## Context

This is the phase that turns HordeNight from "an explorable valley with chasing zombies" into the
actual game: a **day-loot / night-horde loop scored by nights survived**. It builds directly on the
M3 plan (`Game` object owning the update sequence, the `Zombies` entity system, `Player.health`, and
the minimal placeholder HUD). It deliberately absorbs the deferred **M2 day/night cycle**, because
the spec's score metric ("nights survived") and core rhythm depend on it.

Three spec milestones land together here:
- **M2** — running day/night clock + mutable lighting, gating spawn intensity, counting nights.
- **M4** — combat: melee + 3 guns, hitscan, zombie death + feedback, stamina.
- **M5** — loot containers, inventory/hotbar, full HUD, death screen + best-score persistence.

Because it's large, it's split into **four ordered stages (A–D), each independently playable/testable**.

## Decisions (locked with user)

1. **Full day/night cycle (absorb M2).** Real running clock + lighting/fog transitions; day = calm looting window, night = horde; score = nights survived.
2. **Arsenal: melee + 3 guns (pistol, shotgun, automatic rifle), ammo plentiful.** Distinct firing behavior per gun. Looting is mainly about *finding the weapons* + heals, not rationing ammo.
3. **Inventory: hotbar + simple inventory screen.** Weapons on number keys 1–4 (+ scroll), heals as a consumable counter, ammo as per-weapon counters; a Tab panel lists carried items.
4. **Loot: searchable containers (spec).** Crates/lockers/cabinets at building sites + barrels; raycast "Hold E to search" rolls a loot table into the inventory.
5. **Death (upgraded from M3's hard-restart placeholder):** real death screen showing nights survived + best (localStorage), with restart.
6. **Zombie death feedback (decided, tunable):** topple-over + sink/fade via the instanced rig; shotgun/headshot gib burst is a noted stretch.

## Architecture

`Game` (from M3) gains ownership of the cycle, combat, inventory, loot, and score, and sequences them
in `update(dt)`:
`input → player → dayNight → zombies/spawner (phase-gated) → combat.resolve → loot/interaction.resolve → hud.sync`.
`Main.js` stays the bootstrap + renderer/postFx/IO host. Everything stays procedural (no GLTF/assets).

### Stage A — Day/Night cycle + score scaffolding (M2)

- **`Source/Systems/DayNightCycle.js`** — clock with `t` (0..1 of cycle), `phase` (DAY/DUSK/NIGHT/DAWN),
  and a `night` counter. `update(dt)` advances and drives **mutable lighting** through the existing
  hooks generalized from the dev-menu `applyNight`: `sky` sun elevation/`setNight`,
  `weather.setBaseSun`, `weather.baseCol` (fog), `veg.setNight`. Implements the fixes.md "mutable
  lighting state" deferred task. **Gotchas to honor:** `sky.setOvercast(w=0)` runs every frame and
  its baseline must equal the clear-sky uniforms; the sun goes *below horizon* at night now (M3 kept
  it up) → add a moonlight ambient floor + `clouds.setTone` for the dark dome.
- **Spawner gating (extend M3 `Source/Entity/Spawner.js` + `Zombies.js`):** day = low cap / sparse
  wanderers; night = horde, cap + aggression scale with `night`. On **dawn**: surviving zombies flee/
  despawn, `night++`, score updates. The M3 "spawn wave" dev button stays for stress-testing.
- **Score:** `Game.nightsSurvived`; best persists in `localStorage` (`hordenight.best`).
- **HUD (minimal add):** clock + phase indicator + night counter (extends M3 `Hud`).
- **Tests:** cycle phase transitions + night counting; spawner difficulty curve by night number.

### Stage B — Combat core (M4)

- **`Source/Engine/Input.js` (extend):** add mouse button state (down/up) for fire, plus key actions
  reload (R), weapon select (1–4 / scroll), use-heal, interact (E), inventory (Tab). Currently Input
  only tracks keys + mouse-move.
- **`Source/Combat/WeaponDB.js`** — static defs for melee + pistol + shotgun + rifle:
  `{kind, damage, fireRate, auto, magSize, ammoType, pellets+spread (shotgun), range, reload, headMult,
  stamina (melee), kick}`.
- **`Source/Combat/Combat.js`** — firing + damage resolution. Hitscan via **manual ray-vs-zombie
  capsule/sphere tests** against the ~24 active zombies (cheaper and more controllable than raycasting
  the 6 instanced body meshes; gives headshot detection via a head sphere). Melee = short frontal arc.
  Shotgun = N pellet rays in a cone. Auto rifle = full-auto while held, fire-rate limited. Applies
  `zombie.hp -= dmg` (headshot mult) → death (topple+fade) → kill count.
- **`Source/Combat/ViewModel.js`** — procedural first-person weapon model (boxes) per weapon, with
  idle bob, fire kick/recoil, reload motion, weapon-swap raise/lower. Muzzle flash (sprite + brief
  light), camera kick.
- **Hit feedback:** crosshair + hitmarker, blood puff (cheap sprite/particle), zombie hit-flash +
  small knockback.
- **`Source/Player/Player.js` (extend):** add `stamina`/`maxStamina`, drain on sprint + melee, regen
  when idle, sprint gated on stamina. (`health`/`takeDamage` already exist from M3.) Add `heal(n)`.
- **Tests:** weapon damage math (depletion, death threshold, headshot, shotgun pellet sum); ray-vs-
  capsule hit geometry; stamina drain/regen + sprint gating; heal clamp.

### Stage C — Loot + inventory (M5)

- **`Source/Items/ItemDB.js`** — item defs: the 4 weapons, ammo types, bandage/heal; type, stats,
  stack rules, procedural model factory.
- **`Source/Items/LootContainer.js`** — procedural crates/lockers/cabinets placed at `hf.sites`
  (cabins/barn/ruin) + reuse existing barrel positions; each has an interact sphere, `searched` flag,
  and a seeded loot table. Raycast-interact from the camera each frame → nearest container in range →
  "Hold E to search" prompt → hold timer → roll table → items into `Inventory`.
- **`Source/Items/Inventory.js`** — hotbar (weapon slots 1–4, unlocked as found), per-weapon ammo
  counts, heal counter; `addItem`, `selectSlot`, `reload`, `consumeAmmo`, `useHeal`. Pure logic →
  unit-tested.
- **HUD add:** hotbar/active-weapon indicator, ammo counter (mag/reserve), interaction prompt, Tab
  inventory panel.
- **Tests:** inventory add/stack/consume/ammo math; loot-table roll determinism (seed → expected
  result); weapon-unlock flow.

### Stage D — Full HUD, death screen, polish (M5)

- **`Source/Hud/` (grow the M3 single-file Hud into a folder):** crosshair, health + stamina bars,
  ammo, hotbar, clock + night counter + phase, interaction prompt, hitmarker, low-health red
  vignette, Tab inventory panel, and the **death screen** (nights survived + best score + restart).
  Death now routes here instead of M3's `location.reload()`.
- **`Game`** wires death → death screen → restart (fresh run; best score retained).
- **Polish pass:** muzzle/recoil/hit feel, night ambience, dawn relief beat; optional shotgun/headshot
  gib burst (stretch).
- **Tests:** score persistence (best updates only on improvement); death→restart state reset.

## Build sequence

A (cycle + score) → B (combat) → C (loot + inventory) → D (full HUD + death/score). Each stage ends
green on `npm test` + Prettier + a browser smoke check before the next begins.

## Verification

- **`npm test`** green incl. all new pure tests; existing determinism tests still pass (combat/loot/
  spawn timing depend on play, so they stay outside seed-determinism — document this).
- **Prettier** on `Source/**/*.js`, `Tests/**/*.js`, `Index.html`; **`npm run build`** green (add any
  new `Source/**` modules to the build's first-party/SHELL list if required, per the repo rule).
- **Browser (real GPU + CDP/Playwright probes, `window.HN`):**
  - A: day→night transition lights/fog smoothly; spawns ramp at night; survive to dawn → night
    counter increments; sun-below-horizon night looks right (moonlit, not black).
  - B: each weapon fires with distinct feel; zombies take damage, die with feedback; melee drains
    stamina; sprint blocked at zero stamina.
  - C: search a container → loot enters inventory → new gun appears on the hotbar and fires; Tab
    panel lists items; ammo counters update.
  - D: full HUD reads correctly; dying shows the death screen with nights survived + best; restart
    yields a fresh run with best retained.
  - Perf holds with a night horde + view model + HUD (draw calls near M1 levels; zombie rig ≈ 6–7).

## Tunables / risks

- Day/night durations (e.g. ~4 min day / ~2 min night), night escalation curve, weapon damage/
  fire-rate/spread, container density + loot-table weights, stamina rates — all centralized constants.
- **Biggest risk = the day/night lighting rework** (M1 lighting is baked at load; the night sun
  dropping below horizon is new). Do Stage A first and verify on real GPU before combat/loot.
- Manual ray-vs-zombie hit tests must stay in sync with the instanced rig's capsule (one source of
  truth for each zombie's hit sphere/head).

## Out of scope (future)

Crafting / base building / barricades · hunger & thirst · ADS/scopes + weapon attachments · weapon/
ammo crafting · multiple maps/biomes · save-load beyond best score · multiplayer · vehicles · deep
sound design (basic SFX only) · ragdoll physics (procedural topple only).

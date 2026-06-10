# HordeNight

First-person 3D zombie-survival game (7 Days to Die-inspired) built with [Three.js](https://threejs.org/) and Vite. Full design: [docs/superpowers/specs/2026-06-10-hordenight-design.md](docs/superpowers/specs/2026-06-10-hordenight-design.md).

**Current status: Milestone 1** — an explorable, atmospheric world with first-person movement. No gameplay systems yet.

## What's in the world

- **Terrain** — seeded procedural heightfield (simplex FBM), rolling hills, vertex-color surface that shifts between grass, dirt, and rock by height and slope.
- **Stream** — a winding river carved into the terrain with animated, semi-transparent flowing water.
- **Vegetation** — instanced pines, oaks, shrubs, and ~7k wind-swayed grass tufts; everything placed by slope/water/clearing rules.
- **Buildings** — cabins, a barn, stone ruins, and a watchtower on flattened pads, all with collision.
- **Atmosphere** — low warm sun with soft real-time shadows (texel-snapped frustum follows the player), cool ambient fill, scattering sky, distance fog, and procedural WebAudio ambience (wind, birds, water that swells near the stream).
- **Player** — first-person controller: WASD, mouse look, Shift sprint, Space jump; follows terrain height and collides with buildings and tree trunks.

The whole world is generated from one seed (`SEED` in `Source/Main.js`) — no binary assets; textures are canvas-generated.

## Run

```sh
npm install
npm run dev      # dev server
npm run build    # production build -> dist/
npm run preview  # serve the build
npm test         # node unit tests (noise, heightfield, collision)
npm run format   # prettier
```

Open the printed URL and click to lock the pointer.

## Deploy

`base: "./"` keeps the build subpath-friendly. The entry is `Index.html` (PascalCase), so Apache hosts need `DirectoryIndex Index.html` in `.htaccess`.

## Layout

```
Source/
  Main.js            bootstrap + frame loop
  Core/              pure logic, Node-testable (Rng, Noise, Heightfield)
  Engine/            Input, Collision (pure), Sky/lighting, canvas Textures
  World/             Terrain, Water, Vegetation, Buildings, AudioAmbience
  Player/            first-person kinematic controller
Tests/RunAll.js      unit tests
```

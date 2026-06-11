import { strict as assert } from "node:assert";
import { Mulberry } from "../Source/Core/Rng.js";
import { Simplex2, Fbm2 } from "../Source/Core/Noise.js";
import { makeHeightfield, WATER_Y, HALF } from "../Source/Core/Heightfield.js";
import {
  resolveCircleAabb,
  resolveCircleCircle,
  resolvePlayer,
  standHeight,
} from "../Source/Engine/Collision.js";
import { buildSitePaths, pathDistance } from "../Source/Core/SitePaths.js";
import { Player, RADIUS, SPRINT, DT_MAX } from "../Source/Player/Player.js";
import {
  worldAabb,
  cabinParts,
  treeParams,
  placeTrees,
  buildingLayout,
  clutterLayout,
  findSpawn,
} from "../Source/Core/Placement.js";
import { fillTerrain, makeGridSampler } from "../Source/World/TerrainFill.js";
import { makeGrid } from "../Source/Engine/SpatialGrid.js";
import { seek, whiskerAvoid, separation } from "../Source/Entity/Steering.js";
import { tick, pickSpawnPoint, spawnParams } from "../Source/Entity/Spawner.js";
import {
  phaseAt,
  nightMixAt,
  clockAt,
  DayNightCycle,
  DAY_LEN,
  DUSK_LEN,
  CYCLE_LEN,
} from "../Source/Systems/DayNightCycle.js";
import {
  makeZombie,
  step,
  Z_RADIUS,
  ATTACK_RANGE,
  ATTACK_DMG,
  ATTACK_COOLDOWN,
  DEATH_T,
} from "../Source/Entity/Zombie.js";
import { Zombies } from "../Source/Entity/Zombies.js";
import {
  rayZombie,
  hitscan,
  meleeTargets,
  spreadDir,
  HEAD_R,
  BODY_R,
} from "../Source/Combat/Combat.js";
import { WEAPONS } from "../Source/Combat/WeaponDB.js";
import { Inventory, HEAL_AMOUNT } from "../Source/Items/Inventory.js";
import * as THREE from "three";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok ${name}`);
};

test("Rng is deterministic and in [0,1)", () => {
  const a = Mulberry(123);
  const b = Mulberry(123);
  for (let i = 0; i < 1000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test("Simplex is deterministic, seed-dependent, bounded", () => {
  const n1 = Simplex2(9);
  const n2 = Simplex2(9);
  const n3 = Simplex2(10);
  let differs = false;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.137;
    const y = i * 0.291;
    assert.equal(n1(x, y), n2(x, y));
    if (n1(x, y) !== n3(x, y)) differs = true;
    assert.ok(Math.abs(n1(x, y)) <= 1.05);
  }
  assert.ok(differs);
});

test("Fbm stays bounded", () => {
  const f = Fbm2(4);
  for (let i = 0; i < 500; i++) {
    assert.ok(Math.abs(f(i * 0.11, i * 0.07, 5)) <= 1.05);
  }
});

test("Heightfield: same seed -> identical terrain and sites", () => {
  const a = makeHeightfield(7);
  const b = makeHeightfield(7);
  for (let i = 0; i < 300; i++) {
    const x = ((i * 37) % 380) - 190;
    const z = ((i * 53) % 380) - 190;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  }
  assert.deepEqual(a.sites, b.sites);
  assert.equal(a.sites.length, 6);
});

test("Heightfield: stream bed is below water level", () => {
  const hf = makeHeightfield(7);
  for (let z = -180; z <= 180; z += 5) {
    assert.ok(hf.heightAt(hf.streamX(z), z) < WATER_Y);
  }
});

test("Heightfield: land away from the stream stays above water", () => {
  const hf = makeHeightfield(7);
  for (let i = 0; i < 2000; i++) {
    const x = ((i * 91) % (HALF * 2)) - HALF;
    const z = ((i * 47) % (HALF * 2)) - HALF;
    if (hf.streamDist(x, z) > 14) {
      assert.ok(hf.heightAt(x, z) > WATER_Y, `flooded at ${x},${z}`);
    }
  }
});

test("Heightfield: building sites are flat and dry", () => {
  const hf = makeHeightfield(7);
  for (const s of hf.sites) {
    assert.ok(s.y > WATER_Y);
    assert.ok(hf.streamDist(s.x, s.z) >= 30);
    assert.ok(Math.abs(hf.heightAt(s.x + 3, s.z) - s.y) < 0.01);
  }
});

test("Collision: circle pushed out of AABB", () => {
  const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const p = resolveCircleAabb(1.2, 0, 0.5, box);
  assert.ok(p && Math.abs(1.2 + p.x - 1.5) < 1e-9 && p.z === 0);
  assert.equal(resolveCircleAabb(3, 3, 0.5, box), null);
  const inside = resolveCircleAabb(0.9, 0, 0.5, box);
  assert.ok(inside && 0.9 + inside.x >= 1.5 - 1e-9);
});

test("Collision: circle vs circle", () => {
  const p = resolveCircleCircle(0.5, 0, 0.4, { x: 0, z: 0, r: 0.3 });
  assert.ok(p && Math.abs(0.5 + p.x - 0.7) < 1e-9);
  assert.equal(resolveCircleCircle(2, 0, 0.4, { x: 0, z: 0, r: 0.3 }), null);
});

test("Collision: resolvePlayer respects collider heights", () => {
  const boxes = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 3 }];
  const hit = resolvePlayer(1.2, 0, 0.5, 0, 1.7, boxes, []);
  assert.ok(hit.x >= 1.5 - 1e-9);
  const above = resolvePlayer(1.2, 0, 0.5, 3.1, 4.8, boxes, []);
  assert.equal(above.x, 1.2);
});

test("Collision: step-band tops are stood on, not pushed", () => {
  const boxes = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 1 }];
  // feet just above the top (descending onto it): no lateral push
  const r = resolvePlayer(0.9, 0, 0.45, 0.8, 2.5, boxes, []);
  assert.equal(r.x, 0.9);
  // standHeight reports the box top while feet are within the step band
  assert.equal(standHeight(0.9, 0, 0.45, 1.05, boxes, []), 1);
  // feet well below the top: still pushed laterally
  const low = resolvePlayer(1.2, 0, 0.5, 0, 1.7, boxes, []);
  assert.ok(low.x >= 1.5 - 1e-9);
  // a top far above the step band is not standable
  assert.equal(standHeight(0.9, 0, 0.45, 0.2, boxes, []), -Infinity);
  // diagonal off the box corner: exact circle test, no standing on air
  assert.equal(standHeight(1.4, 1.4, 0.45, 1.05, boxes, []), -Infinity);
  // circles behave the same
  const circles = [{ x: 0, z: 0, r: 0.4, topY: 1 }];
  assert.equal(standHeight(0.3, 0, 0.45, 1.1, [], circles), 1);
});

test("Collision: a top crossed from above in one frame lands, never slides off", () => {
  const boxes = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 1 }];
  // low-fps fall: feet went 1.2 -> 0.4 in a single frame (0.6 below the top)
  const r = resolvePlayer(0.9, 0, 0.45, 0.4, 2.1, boxes, [], 1.2);
  assert.equal(r.x, 0.9); // no lateral pop
  assert.equal(standHeight(0.9, 0, 0.45, 0.4, boxes, [], 1.2), 1); // lands on top
  // the same depth without from-above history is still pushed out laterally
  const pushed = resolvePlayer(1.2, 0, 0.5, 0.4, 2.1, boxes, [], 0.4);
  assert.ok(pushed.x >= 1.5 - 1e-9);
  // circles follow the same rule
  const circles = [{ x: 0, z: 0, r: 0.4, topY: 1 }];
  assert.equal(standHeight(0.3, 0, 0.45, 0.4, [], circles), -Infinity);
  assert.equal(standHeight(0.3, 0, 0.45, 0.4, [], circles, 1.2), 1);
});

test("Player: max per-frame step cannot tunnel a 0.2m wall", () => {
  // the resolver ejects to the NEAR face only while the circle center hasn't
  // crossed a wall's midplane; one sprint step must stay under the radius
  assert.ok(SPRINT * DT_MAX < RADIUS);
});

test("SitePaths: deterministic, deduped, rejects stream crossings", () => {
  const sites = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 220, z: 220 },
  ];
  const noStream = () => 999;
  const p1 = buildSitePaths(sites, noStream);
  assert.deepEqual(p1, buildSitePaths(sites, noStream));
  assert.equal(p1.length, 1); // mutual pair deduped; isolated site dropped
  const streamAt25 = (x) => Math.abs(x - 25);
  assert.equal(buildSitePaths(sites, streamAt25).length, 0);
  assert.ok(Math.abs(pathDistance(p1, 25, 10) - 10) < 1e-9);
  assert.ok(Math.abs(pathDistance(p1, -20, 0) - 20) < 1e-9);
});

test("Placement: worldAabb matches the THREE transform used for meshes", () => {
  const g = new THREE.Group();
  const v = new THREE.Vector3();
  const rng = Mulberry(31337);
  for (let i = 0; i < 200; i++) {
    const s = {
      w: 0.2 + rng() * 8,
      d: 0.2 + rng() * 8,
      x: (rng() - 0.5) * 10,
      z: (rng() - 0.5) * 10,
      h: rng() * 5,
      y0: rng() < 0.5 ? rng() * 2 : undefined,
    };
    const x = (rng() - 0.5) * 300;
    const y = rng() * 20;
    const z = (rng() - 0.5) * 300;
    const rot = ((rng() * 4) | 0) * (Math.PI / 2);
    g.position.set(x, y - 0.06, z);
    g.rotation.y = rot;
    g.updateMatrixWorld(true);
    v.set(s.x, 0, s.z).applyMatrix4(g.matrixWorld);
    const w = rot % Math.PI === 0 ? s.w : s.d;
    const d = rot % Math.PI === 0 ? s.d : s.w;
    const a = worldAabb(s, x, y, z, rot);
    assert.ok(Math.abs(a.minX - (v.x - w / 2)) < 1e-9);
    assert.ok(Math.abs(a.maxX - (v.x + w / 2)) < 1e-9);
    assert.ok(Math.abs(a.minZ - (v.z - d / 2)) < 1e-9);
    assert.ok(Math.abs(a.maxZ - (v.z + d / 2)) < 1e-9);
    assert.equal(a.minY, y + (s.y0 ?? -1));
    assert.equal(a.maxY, y + s.h);
  }
});

test("Placement: cabin shell - doorway passes, lintel blocks, floor stands", () => {
  const p = cabinParts(7);
  const boxes = p.solids.map((s) => worldAabb(s, 0, 0, 0, 0));
  const doorX = p.doorOff;
  const doorZ = (p.D - 0.2) / 2; // doorway wall plane
  // standing player passes through the doorway (head clears the lintel)
  const thru = resolvePlayer(doorX, doorZ, 0.45, 0.2, 1.9, boxes, []);
  assert.equal(thru.x, doorX);
  assert.equal(thru.z, doorZ);
  // a jumper's head enters the lintel band and is pushed out
  const jump = resolvePlayer(doorX, doorZ, 0.45, 0.5, 2.2, boxes, []);
  assert.ok(jump.z !== doorZ);
  // floor is step-band standable inside
  assert.equal(standHeight(0, 0, 0.45, 0.2, boxes, []), 0.12);
  // hugging an outside wall must NOT hoist onto a phantom floor ledge
  assert.equal(
    standHeight(0, -(p.D / 2 + 0.46), 0.45, 0, boxes, []),
    -Infinity,
  );
  // a solid wall still blocks
  const mid = -(p.D / 2 - 0.05);
  const blocked = resolvePlayer(0, mid, 0.45, 0.2, 1.9, boxes, []);
  assert.ok(blocked.z !== mid);
});

test("Placement: treeParams is the single draw site (pinned values)", () => {
  const a = treeParams(0, 7, 101);
  const b = treeParams(0, 7, 101);
  assert.deepEqual(a, b);
  // pinned: an accidental extra/reordered rng draw inside shifts these
  const r = Mulberry(0 * 7 + 7 + 101);
  assert.equal(a.rot, r() * Math.PI * 2);
  assert.equal(a.ys, 0.92 + r() * 0.16);
  const g = 0.95 + r() * 0.3;
  assert.equal(a.g, g);
  assert.equal(a.red, g * (0.95 + r() * 0.1));
  assert.ok(treeParams(1, 7, 101).rot !== a.rot);
});

test("TerrainFill: worker fill matches the THREE geometry computation", () => {
  const RES = 48;
  const geo = new THREE.PlaneGeometry(400, 400, RES, RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const n = pos.count;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pos.getX(i);
    zs[i] = pos.getZ(i);
  }
  const index = new Uint32Array(geo.index.array);
  const fill = fillTerrain(7, xs, zs, index);
  const hf = makeHeightfield(7);
  for (let i = 0; i < n; i++) pos.setY(i, hf.heightAt(xs[i], zs[i]));
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    maxD = Math.max(
      maxD,
      Math.abs(fill.heights[i] - pos.getY(i)),
      Math.abs(fill.normals[i * 3] - nor.getX(i)),
      Math.abs(fill.normals[i * 3 + 1] - nor.getY(i)),
      Math.abs(fill.normals[i * 3 + 2] - nor.getZ(i)),
    );
  }
  assert.ok(maxD < 1e-6, `terrain fill diverges from the mesh: ${maxD}`);
  const grid = makeGridSampler(fill.heights, RES, 400);
  assert.ok(Math.abs(grid(xs[100], zs[100]) - fill.heights[100]) < 1e-3);
});

test("Placement: spawn is validated clear across seeds 1-20", () => {
  // analytic heights (browser uses the bilinear grid - same lattice values,
  // centimeter-scale differences between vertices); trunk radius 0.7 is a
  // conservative superset of any real trunk collider
  for (let seed = 1; seed <= 20; seed++) {
    const hf = makeHeightfield(seed);
    const b = buildingLayout(hf);
    const c = clutterLayout(hf, b.colliders);
    const { pines, oaks } = placeTrees(Mulberry(hf.seed + 31), hf);
    assert.ok(pines.length + oaks.length <= 1500);
    const circles = [
      ...b.circles,
      ...c.circles,
      ...[...pines, ...oaks].map((t) => ({ x: t.x, z: t.z, r: 0.7 })),
    ];
    const s = findSpawn(hf, circles, b.colliders);
    assert.ok(s.clear, `seed ${seed}: spawn not validated clear`);
  }
});

test("Player: WASD moves along camera axes at any yaw", () => {
  const run = (yaw, key) => {
    const input = { consumeLook: () => [0, 0], down: (c) => c === key };
    const camera = { position: new THREE.Vector3(), rotation: { set() {} } };
    const p = new Player(camera, input, { heightAt: () => 0 }, [], [], {
      x: 0,
      z: 0,
      yaw,
    });
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    const len = Math.hypot(p.vel.x, p.vel.z);
    return { x: p.vel.x / len, z: p.vel.z / len };
  };
  for (const yaw of [0, Math.PI / 2, Math.PI, -2.1]) {
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const dot = (v, u) => v.x * u.x + v.z * u.z;
    assert.ok(dot(run(yaw, "KeyW"), fwd) > 0.99, `W not forward at ${yaw}`);
    assert.ok(dot(run(yaw, "KeyS"), fwd) < -0.99, `S not back at ${yaw}`);
    assert.ok(dot(run(yaw, "KeyD"), right) > 0.99, `D not right at ${yaw}`);
    assert.ok(dot(run(yaw, "KeyA"), right) < -0.99, `A not left at ${yaw}`);
  }
});

test("SpatialGrid: extent inserts land in every touched cell, queries dedup", () => {
  const g = makeGrid(8);
  const wall = { id: "wall" };
  const rock = { id: "rock" };
  g.insert(wall, -10, -10, 10, 10);
  g.insert(rock, 30, 30);
  const near = g.queryRadius(0, 0, 5);
  assert.deepEqual(near, [wall]); // present once despite spanning many cells
  assert.ok(g.queryRadius(9, 9, 3).includes(wall));
  assert.ok(g.queryRadius(30, 28, 4).includes(rock));
  assert.deepEqual(g.queryRadius(100, 100, 5), []);
});

test("Steering: seek points at the target scaled to speed", () => {
  const v = seek(0, 0, 3, 4, 2.5);
  assert.ok(Math.abs(v.x - 1.5) < 1e-9 && Math.abs(v.z - 2) < 1e-9);
  assert.deepEqual(seek(1, 1, 1, 1, 5), { x: 0, z: 0 });
});

test("Steering: whiskers deflect sideways around a box ahead, silent when clear", () => {
  const box = { minX: 1, maxX: 3, minZ: -1, maxZ: 1 };
  const d = whiskerAvoid(0, 0, 1, 0, [box]);
  assert.ok(Math.hypot(d.x, d.z) > 0.5, "no deflection in front of a wall");
  assert.ok(Math.abs(d.z) > Math.abs(d.x), "deflection is not sideways");
  const clear = whiskerAvoid(0, 0, -1, 0, [box]);
  assert.deepEqual(clear, { x: 0, z: 0 });
  const circle = { x: 2, z: 0, r: 0.5 };
  assert.ok(Math.hypot(whiskerAvoid(0, 0, 1, 0, [circle]).z) > 0);
});

test("Steering: separation pushes apart, fades with distance, skips self", () => {
  const close = separation(0, 0, [{ x: 0.4, z: 0 }], 1.1);
  assert.ok(close.x < 0 && close.z === 0);
  const far = separation(0, 0, [{ x: 0.9, z: 0 }], 1.1);
  assert.ok(far.x < 0 && Math.abs(far.x) < Math.abs(close.x));
  assert.deepEqual(separation(0, 0, [{ x: 0, z: 0 }], 1.1), { x: 0, z: 0 });
  assert.deepEqual(separation(0, 0, [{ x: 5, z: 0 }], 1.1), { x: 0, z: 0 });
});

test("Spawner: cadence accumulates, cap clamps, no burst banking", () => {
  let s = tick({ active: 0, cap: 4, accum: 0, dt: 0.5, rate: 1 });
  assert.equal(s.spawns, 0);
  assert.ok(Math.abs(s.accum - 0.5) < 1e-9);
  s = tick({ active: 0, cap: 4, accum: s.accum, dt: 0.6, rate: 1 });
  assert.equal(s.spawns, 1);
  assert.ok(s.accum < 1);
  // long stretch at cap must not bank a burst for when a slot frees
  s = tick({ active: 4, cap: 4, accum: 0, dt: 30, rate: 1 });
  assert.equal(s.spawns, 0);
  assert.ok(s.accum <= 1);
  // a big dt below cap clamps to free slots and drops the excess
  s = tick({ active: 2, cap: 4, accum: 0, dt: 10, rate: 1 });
  assert.equal(s.spawns, 2);
  assert.ok(s.accum <= 1);
});

test("Spawner: pickSpawnPoint stays in the radius band, out of view, clear", () => {
  const rng = Mulberry(5);
  for (let i = 0; i < 50; i++) {
    const facing = rng() * Math.PI * 2;
    const p = pickSpawnPoint(10, -5, facing, rng, () => true);
    const dx = p.x - 10;
    const dz = p.z - -5;
    const d = Math.hypot(dx, dz);
    assert.ok(d > 28 - 1e-9 && d < 45 + 1e-9, `radius ${d}`);
    // candidate never lands in the forward 120-degree cone
    const dot = (dx / d) * Math.cos(facing) + (dz / d) * Math.sin(facing);
    assert.ok(dot <= 0.5 + 1e-9, `in view cone: dot ${dot}`);
  }
  assert.equal(
    pickSpawnPoint(0, 0, 0, Mulberry(5), () => false),
    null,
  );
  // clearance is honored: only a specific far spot passes
  const picky = pickSpawnPoint(
    0,
    0,
    0,
    Mulberry(11),
    (x) => x < -30, // only points well behind (facing 0 = +x)
  );
  assert.ok(picky === null || picky.x < -30);
});

test("Zombie: chase closes distance, then stops and attacks in range", () => {
  const z = makeZombie(12, 0, 0.4);
  const d0 = Math.hypot(z.x, z.z);
  let hits = 0;
  let firstHitAt = -1;
  for (let i = 0; i < 600; i++) {
    step(z, 0, 0, [], [z], 1 / 60);
    if (z.attacked) {
      hits++;
      if (firstHitAt < 0) firstHitAt = i;
    }
  }
  const d1 = Math.hypot(z.x, z.z);
  assert.ok(d1 < ATTACK_RANGE + 0.3, `never reached the player: ${d1}`);
  assert.ok(d1 < d0 - 9, "did not close distance");
  assert.equal(z.state, "ATTACK");
  assert.ok(hits >= 4 && hits <= 8, `hit cadence off: ${hits} in 10s`);
  // wind-up: no hit before the initial cooldown elapsed
  assert.ok(firstHitAt >= Math.floor(0.4 * 60) - 1);
});

test("Zombie: attack cooldown spaces hits ~1s apart", () => {
  const z = makeZombie(0.8, 0, 0.1);
  const frames = [];
  for (let i = 0; i < 300; i++) {
    step(z, 0, 0, [], [z], 1 / 60);
    if (z.attacked) frames.push(i);
  }
  assert.ok(frames.length >= 2);
  for (let i = 1; i < frames.length; i++) {
    const gap = (frames[i] - frames[i - 1]) / 60;
    assert.ok(Math.abs(gap - ATTACK_COOLDOWN) < 0.05, `gap ${gap}`);
  }
});

test("Zombie: slides around a wall without ever clipping it", () => {
  // 4m wall between zombie and player
  const wall = { minX: -0.2, maxX: 0.2, minZ: -2, maxZ: 2, minY: 0, maxY: 2.5 };
  const z = makeZombie(3, 0.3, 0.5);
  const d0 = Math.hypot(z.x + 3, z.z);
  for (let i = 0; i < 900; i++) {
    step(z, -3, 0, [wall], [z], 1 / 60);
    const inX =
      z.x > wall.minX - Z_RADIUS + 0.01 && z.x < wall.maxX + Z_RADIUS - 0.01;
    const inZ =
      z.z > wall.minZ - Z_RADIUS + 0.01 && z.z < wall.maxZ + Z_RADIUS - 0.01;
    assert.ok(!(inX && inZ), `clipped the wall at frame ${i}: ${z.x},${z.z}`);
  }
  const d1 = Math.hypot(z.x + 3, z.z);
  assert.ok(d1 < d0 - 1.5, `made no progress around the wall: ${d1}`);
});

test("DayNight: phases in order, mix ramps across dusk/dawn", () => {
  assert.equal(phaseAt(0).phase, "DAY");
  assert.equal(phaseAt(DAY_LEN + 1).phase, "DUSK");
  assert.equal(phaseAt(DAY_LEN + DUSK_LEN + 1).phase, "NIGHT");
  assert.equal(phaseAt(CYCLE_LEN - 1).phase, "DAWN");
  assert.equal(phaseAt(CYCLE_LEN).phase, "DAY"); // wraps
  assert.equal(nightMixAt(10), 0);
  assert.ok(Math.abs(nightMixAt(DAY_LEN + DUSK_LEN / 2) - 0.5) < 1e-9);
  assert.equal(nightMixAt(DAY_LEN + DUSK_LEN + 5), 1);
  assert.ok(nightMixAt(CYCLE_LEN - 1) < 1); // dawn ramps back down
  assert.equal(clockAt(0), "07:00");
  assert.equal(clockAt(CYCLE_LEN / 2), "19:00");
});

test("DayNight: night counting, dawn events, dev jump", () => {
  const c = new DayNightCycle();
  let dawns = 0;
  for (let t = 0; t < CYCLE_LEN * 2.5; t += 0.5) {
    if (c.update(0.5).dawned) dawns++;
  }
  assert.equal(c.night, 2); // two dusks passed in 2.5 cycles
  assert.equal(dawns, 2); // both nights survived
  // jump applies lighting immediately and bumps the night counter
  let applied = null;
  const c2 = new DayNightCycle((m) => (applied = m));
  assert.equal(applied, 0);
  c2.jump("NIGHT");
  assert.equal(c2.phase, "NIGHT");
  assert.equal(c2.night, 1);
  assert.equal(applied, 1);
  c2.jump("DAY");
  assert.equal(applied, 0);
  assert.equal(c2.night, 1); // day jump never counts a night
  // no double-count when update crosses the same boundary after a jump
  const c3 = new DayNightCycle();
  c3.jump("NIGHT");
  c3.update(0.5);
  assert.equal(c3.night, 1);
});

test("Spawner: difficulty curve - day calm, night ramps with night number", () => {
  const d = spawnParams("DAY", 3);
  const n1 = spawnParams("NIGHT", 1);
  const n4 = spawnParams("NIGHT", 4);
  assert.ok(d.cap < n1.cap && d.rate < n1.rate);
  assert.ok(n4.cap > n1.cap && n4.rate > n1.rate);
  assert.ok(n4.speedMul > n1.speedMul);
  assert.ok(spawnParams("NIGHT", 99).cap <= 40); // stays under the 48 pool
  assert.ok(spawnParams("NIGHT", 99).speedMul <= 1.45);
  assert.ok(spawnParams("DUSK", 1).cap > d.cap);
  assert.deepEqual(spawnParams("DAWN", 5), spawnParams("DAY", 5));
});

test("Zombie: flee runs away from the player and never attacks", () => {
  const z = makeZombie(2, 0, 0.05);
  z.flee = true;
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    step(z, 0, 0, [], [z], 1 / 60);
    if (z.attacked) hits++;
  }
  assert.ok(Math.hypot(z.x, z.z) > 7, "did not run away");
  assert.equal(hits, 0);
  assert.equal(z.state, "FLEE");
  assert.ok(z.fleeT > 4.9);
});

test("Combat: ray hits body capsule and head sphere at the right depths", () => {
  const z = makeZombie(10, 0);
  let h = rayZombie(0, 0.9, 0, 1, 0, 0, z); // chest height
  assert.ok(h && !h.head);
  assert.ok(Math.abs(h.t - (10 - BODY_R)) < 1e-9);
  h = rayZombie(0, 1.5, 0, 1, 0, 0, z); // head height
  assert.ok(h && h.head);
  assert.ok(Math.abs(h.t - (10 - HEAD_R)) < 1e-9);
  assert.equal(rayZombie(0, 2.1, 0, 1, 0, 0, z), null); // over the head
  assert.equal(rayZombie(0, 0.9, 0, -1, 0, 0, z), null); // behind the ray
  // scaled zombie scales its volumes
  const big = makeZombie(10, 0);
  big.scale = 1.2;
  assert.ok(rayZombie(0, 1.5 * 1.2, 0, 1, 0, 0, big).head);
});

test("Combat: hitscan picks the nearest living target within range", () => {
  const far = makeZombie(8, 0);
  const near = makeZombie(5, 0);
  const corpse = makeZombie(3, 0);
  corpse.dying = 0.3;
  const hit = hitscan(0, 0.9, 0, 1, 0, 0, [far, near, corpse], 80);
  assert.equal(hit.z, near); // corpse is transparent to bullets
  assert.equal(hitscan(0, 0.9, 0, 1, 0, 0, [far], 5), null); // out of range
});

test("Combat: damage math - depletion, kill threshold, knockback, no double kill", () => {
  const ctx = { kills: 0 };
  const z = makeZombie(0, 0);
  const killed = Zombies.prototype.damage.call(ctx, z, 30, 1, 0, 2);
  assert.equal(killed, false);
  assert.equal(z.hp, 30);
  assert.ok(z.flash > 0 && z.vx > 0); // hit-flash + knockback
  assert.equal(Zombies.prototype.damage.call(ctx, z, 30), true);
  assert.ok(z.dying > 0);
  assert.equal(ctx.kills, 1);
  // a corpse absorbs nothing and never double-counts
  assert.equal(Zombies.prototype.damage.call(ctx, z, 99), false);
  assert.equal(ctx.kills, 1);
  // weapon sanity: point-blank shotgun one-shots, pistol headshot does not
  assert.ok(WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage >= 60);
  assert.ok(WEAPONS.pistol.damage * WEAPONS.pistol.headMult < 60);
  assert.equal(DEATH_T, 1.4);
});

test("Combat: spread stays inside the cone, melee arc is frontal-only", () => {
  const rng = Mulberry(17);
  for (let i = 0; i < 200; i++) {
    const s = spreadDir(0, 0, -1, 0.05, rng);
    assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
    assert.ok(-s.z >= Math.cos(0.0501), `outside cone: ${-s.z}`);
  }
  assert.deepEqual(spreadDir(0, 0, -1, 0, rng), { x: 0, y: 0, z: -1 });
  // melee: in front + in range only, sorted nearest first
  const a = makeZombie(1.5, 0);
  const b = makeZombie(1.0, 0.2);
  const behind = makeZombie(-1.2, 0);
  const farZ = makeZombie(5, 0);
  const t = meleeTargets(0, 0, 1, 0, [a, b, behind, farZ], 2.3, 1.2);
  assert.deepEqual(
    t.map((x) => x.z),
    [b, a],
  );
});

test("Inventory: unlock flow, ammo math, reload, cycle, heal", () => {
  const inv = new Inventory();
  assert.equal(inv.selected, "bat");
  assert.equal(inv.select(1), false); // pistol locked
  inv.addItem("pistol");
  assert.equal(inv.mag.pistol, WEAPONS.pistol.mag); // starter mag
  assert.ok(inv.select(1));
  for (let i = 0; i < WEAPONS.pistol.mag; i++)
    assert.ok(inv.consumeRound("pistol"));
  assert.equal(inv.consumeRound("pistol"), false); // dry
  assert.equal(inv.canReload("pistol"), false); // no reserve yet
  inv.addItem("9mm", 30);
  assert.ok(inv.canReload("pistol"));
  inv.finishReload("pistol");
  assert.equal(inv.mag.pistol, 12);
  assert.equal(inv.reserve["9mm"], 18);
  // partial reserve tops up what it can
  inv.reserve["9mm"] = 3;
  inv.mag.pistol = 4;
  inv.finishReload("pistol");
  assert.equal(inv.mag.pistol, 7);
  assert.equal(inv.reserve["9mm"], 0);
  // cycle skips locked slots (shotgun/rifle locked): bat <-> pistol
  inv.selected = "bat";
  assert.ok(inv.cycle(1));
  assert.equal(inv.selected, "pistol");
  assert.ok(inv.cycle(1));
  assert.equal(inv.selected, "bat");
  // melee never consumes
  assert.ok(inv.consumeRound("bat"));
  // heals
  assert.equal(inv.useHeal(), 0);
  inv.addItem("bandage", 2);
  assert.equal(inv.useHeal(), HEAL_AMOUNT);
  assert.equal(inv.heals, 1);
});

test("Player: stamina drains on sprint, gates sprint at zero, regens after delay", () => {
  const keys = new Set(["KeyW", "ShiftLeft"]);
  const input = { consumeLook: () => [0, 0], down: (c) => keys.has(c) };
  const camera = { position: new THREE.Vector3(), rotation: { set() {} } };
  const p = new Player(camera, input, { heightAt: () => 0 }, [], [], {
    x: 0,
    z: 0,
    yaw: 0,
  });
  for (let i = 0; i < 120; i++) p.update(1 / 60); // 2s sprint
  assert.ok(p.stamina < 75 && p.stamina > 55, `drain off: ${p.stamina}`);
  assert.ok(Math.hypot(p.vel.x, p.vel.z) > 8, "not sprinting");
  // empty tank: winded hysteresis locks sprint until 15 stamina
  p.stamina = 0.4;
  for (let i = 0; i < 30; i++) p.update(1 / 60);
  assert.ok(p.winded, "not winded at empty");
  assert.ok(Math.hypot(p.vel.x, p.vel.z) < 6, "sprint not gated when winded");
  keys.clear(); // stop: regen kicks in after the delay
  for (let i = 0; i < 90; i++) p.update(1 / 60);
  assert.ok(p.stamina > 2, "no regen");
  // melee spend
  assert.equal(p.useStamina(1e6), false);
  const before = p.stamina;
  assert.ok(p.useStamina(1));
  assert.ok(p.stamina < before);
  // heal clamps
  p.health = 90;
  p.heal(35);
  assert.equal(p.health, 100);
});

test("Player: takeDamage clamps at zero and sets dead exactly once", () => {
  const input = { consumeLook: () => [0, 0], down: () => false };
  const camera = { position: new THREE.Vector3(), rotation: { set() {} } };
  const p = new Player(camera, input, { heightAt: () => 0 }, [], [], {
    x: 0,
    z: 0,
    yaw: 0,
  });
  assert.equal(p.health, 100);
  assert.equal(p.dead, false);
  for (let i = 0; i < 9; i++) p.takeDamage(ATTACK_DMG);
  assert.equal(p.health, 10);
  assert.equal(p.dead, false);
  p.takeDamage(ATTACK_DMG * 5); // overkill clamps
  assert.equal(p.health, 0);
  assert.equal(p.dead, true);
  p.takeDamage(ATTACK_DMG); // no-op once dead
  assert.equal(p.health, 0);
});

console.log(`\n${passed} tests passed`);

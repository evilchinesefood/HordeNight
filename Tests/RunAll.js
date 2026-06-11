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

console.log(`\n${passed} tests passed`);

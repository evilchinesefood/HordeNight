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
  // circles behave the same
  const circles = [{ x: 0, z: 0, r: 0.4, topY: 1 }];
  assert.equal(standHeight(0.3, 0, 0.45, 1.1, [], circles), 1);
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

console.log(`\n${passed} tests passed`);

// zombie system orchestrator owned by Game: pool + static collider grid +
// spawner cadence + instanced rig. Deliberately OUTSIDE seed determinism:
// spawn timing and chase paths depend on live player movement, so none of
// the world's Mulberry streams are touched here.
import { makeGrid } from "../Engine/SpatialGrid.js";
import { ZombieMesh } from "./ZombieMesh.js";
import { tick, pickSpawnPoint } from "./Spawner.js";
import { makeZombie, step, ATTACK_DMG, Z_RADIUS } from "./Zombie.js";
import { isClearAt } from "../Core/Placement.js";

const MAX_POOL = 48;
const CAP = 24;
const SPAWN_RATE = 0.7; // spawns/sec while under cap
const RECYCLE_DIST = 75;
const GRID_CELL = 8;
const QUERY_R = 3.5; // covers whisker length + zombie radius

export class Zombies {
  constructor({ heightAt, hf, boxes, circles, rng }) {
    this.heightAt = heightAt;
    this.rng = rng;
    this.accum = 0;
    this.pool = Array.from({ length: MAX_POOL }, () => {
      const z = makeZombie(0, 0);
      z.active = false;
      return z;
    });
    this.active = [];
    this.mesh = new ZombieMesh(MAX_POOL);
    this.group = this.mesh.group;
    this.isClear = (x, z) =>
      isClearAt(hf, circles, boxes, x, z, Z_RADIUS + 0.4);

    // static blockers only: floors/rubble under step height and lintels above
    // head height are filtered out, so doorways stay walkable
    this.grid = makeGrid(GRID_CELL);
    for (const b of boxes) {
      const g = hf.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      if (b.maxY > g + 0.45 && b.minY < g + 1.7)
        this.grid.insert(b, b.minX, b.minZ, b.maxX, b.maxZ);
    }
    for (const c of circles) {
      const g = hf.heightAt(c.x, c.z);
      if ((c.topY ?? Infinity) > g + 0.45)
        this.grid.insert(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
    }
  }

  trySpawn(player) {
    const slot = this.pool.findIndex((z) => !z.active);
    if (slot < 0) return false;
    const yaw = player.yaw;
    const facing = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    const p = pickSpawnPoint(
      player.pos.x,
      player.pos.z,
      facing,
      this.rng,
      this.isClear,
    );
    if (!p) return false;
    const z = makeZombie(
      p.x,
      p.z,
      0.5 + this.rng() * 0.6,
      2.1 + this.rng() * 0.9,
    );
    z.scale = 0.92 + this.rng() * 0.16;
    z.phase = this.rng() * Math.PI * 2;
    z.y = this.heightAt(p.x, p.z);
    z.yaw = Math.atan2(-(player.pos.x - p.x), -(player.pos.z - p.z));
    this.pool[slot] = z;
    this.mesh.setColor(slot, this.rng);
    return true;
  }

  spawnWave(player, n = 8) {
    for (let i = 0; i < n; i++) if (!this.trySpawn(player)) break;
  }

  update(dt, player) {
    const px = player.pos.x;
    const pz = player.pos.z;
    let count = 0;
    for (const z of this.pool) {
      if (!z.active) continue;
      const dx = z.x - px;
      const dz = z.z - pz;
      if (dx * dx + dz * dz > RECYCLE_DIST * RECYCLE_DIST) z.active = false;
      else count++;
    }
    const t = tick({
      active: count,
      cap: CAP,
      accum: this.accum,
      dt,
      rate: SPAWN_RATE,
    });
    this.accum = t.accum;
    for (let i = 0; i < t.spawns; i++) this.trySpawn(player);

    this.active = this.pool.filter((z) => z.active);
    for (const z of this.active) {
      const nearby = this.grid.queryRadius(z.x, z.z, QUERY_R);
      step(z, px, pz, nearby, this.active, dt);
      z.y = this.heightAt(z.x, z.z);
      if (z.attacked) player.takeDamage(ATTACK_DMG);
    }
    this.mesh.write(this.pool);
  }
}

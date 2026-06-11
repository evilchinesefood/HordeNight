// zombie system orchestrator owned by Game: pool + static collider grid +
// spawner cadence + instanced rig. Deliberately OUTSIDE seed determinism:
// spawn timing and chase paths depend on live player movement, so none of
// the world's Mulberry streams are touched here.
import { makeGrid } from "../Engine/SpatialGrid.js";
import { ZombieMesh } from "./ZombieMesh.js";
import { tick, pickSpawnPoint, spawnParams } from "./Spawner.js";
import { makeZombie, step, ATTACK_DMG, Z_RADIUS, DEATH_T } from "./Zombie.js";
import { isClearAt } from "../Core/Placement.js";

const MAX_POOL = 48;
const RECYCLE_DIST = 75;
const FLEE_DESPAWN = 40; // dawn survivors vanish once far enough out
const FLEE_TIMEOUT = 15;
const GRID_CELL = 8;
const QUERY_R = 3.5; // covers whisker length + zombie radius

export class Zombies {
  constructor({ heightAt, hf, boxes, circles, rng }) {
    this.heightAt = heightAt;
    this.rng = rng;
    this.accum = 0;
    this.kills = 0;
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
    z.baseSpeed = z.speed; // night escalation scales from this
    z.scale = 0.92 + this.rng() * 0.16;
    z.phase = this.rng() * Math.PI * 2;
    z.y = this.heightAt(p.x, p.z);
    z.yaw = Math.atan2(-(player.pos.x - p.x), -(player.pos.z - p.z));
    // greenish-gray skin + muted clothes; the rig multiplies these in
    const g = 0.5 + this.rng() * 0.18;
    z.skin = [g * 0.72, g, g * 0.68];
    const t = 0.2 + this.rng() * 0.16;
    z.cloth = [t * (0.8 + this.rng() * 0.4), t * 0.9, t];
    this.pool[slot] = z;
    return true;
  }

  // combat entry point; returns true when the hit was the kill
  damage(z, dmg, dirx = 0, dirz = 0, knock = 0) {
    if (!z.active || z.dying > 0) return false;
    z.hp -= dmg;
    z.flash = 0.12;
    z.vx += dirx * knock;
    z.vz += dirz * knock;
    if (z.hp > 0) return false;
    z.dying = 1e-4; // topple starts this frame
    z.state = "DEAD";
    this.kills++;
    return true;
  }

  spawnWave(player, n = 8) {
    for (let i = 0; i < n; i++) if (!this.trySpawn(player)) break;
  }

  update(dt, player, cycle = { phase: "NIGHT", night: 1, dawned: false }) {
    const px = player.pos.x;
    const pz = player.pos.z;
    const params = spawnParams(cycle.phase, cycle.night);
    let count = 0;
    for (const z of this.pool) {
      if (!z.active) continue;
      if (cycle.dawned) {
        z.flee = true; // the horde breaks at first light
        z.fleeT = 0;
      }
      const dx = z.x - px;
      const dz = z.z - pz;
      const d2 = dx * dx + dz * dz;
      if (
        d2 > RECYCLE_DIST * RECYCLE_DIST ||
        (z.flee && (d2 > FLEE_DESPAWN * FLEE_DESPAWN || z.fleeT > FLEE_TIMEOUT))
      )
        z.active = false;
      else count++;
    }
    const t = tick({
      active: count,
      cap: params.cap,
      accum: this.accum,
      dt,
      rate: params.rate,
    });
    this.accum = t.accum;
    for (let i = 0; i < t.spawns; i++) this.trySpawn(player);

    this.active = this.pool.filter((z) => z.active);
    for (const z of this.active) {
      z.flash = Math.max(0, z.flash - dt);
      if (z.dying > 0) {
        z.dying += dt; // corpse: topple clock only, no steering
        if (z.dying >= DEATH_T) z.active = false;
        continue;
      }
      z.speed = (z.baseSpeed ?? z.speed) * params.speedMul;
      const nearby = this.grid.queryRadius(z.x, z.z, QUERY_R);
      step(z, px, pz, nearby, this.active, dt);
      z.y = this.heightAt(z.x, z.z);
      if (z.attacked) player.takeDamage(ATTACK_DMG);
    }
    this.mesh.write(this.pool);
  }
}

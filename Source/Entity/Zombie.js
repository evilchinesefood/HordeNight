// pure per-zombie simulation step: steering toward the player, hard
// resolution against nearby static colliders, contact-attack timing.
// Intentionally outside seed determinism - spawn timing and chase paths
// depend on live player movement.
import { seek, whiskerAvoid, separation } from "./Steering.js";
import { resolveCircleAabb, resolveCircleCircle } from "../Engine/Collision.js";
import { BOUND } from "../Core/Heightfield.js";

export const Z_RADIUS = 0.4;
export const ATTACK_RANGE = 1.25; // center-to-center, player R 0.45 + reach
export const ATTACK_DMG = 10;
export const ATTACK_COOLDOWN = 1.0;
export const SEP_RADIUS = 1.1;
const ACCEL = 6;
const TURN = 9;

export const makeZombie = (x, z, cd = 0.5, speed = 2.5) => ({
  x,
  z,
  y: 0,
  vx: 0,
  vz: 0,
  yaw: 0,
  phase: 0,
  speed,
  cd,
  lunge: 0,
  hp: 60, // seam for M4 - nothing damages zombies yet
  scale: 1,
  state: "CHASE",
  attacked: false,
  active: true,
  flee: false, // dawn survivors run out and despawn
  fleeT: 0,
});

export function step(z, px, pz, nearby, neighbors, dt) {
  z.attacked = false;
  const dx = px - z.x;
  const dz = pz - z.z;
  const dist = Math.hypot(dx, dz);

  let wantX = 0;
  let wantZ = 0;
  const sep = separation(z.x, z.z, neighbors, SEP_RADIUS);
  if (z.flee) {
    z.state = "FLEE";
    z.fleeT += dt;
    const s = seek(px, pz, z.x, z.z); // away from the player
    const a = whiskerAvoid(z.x, z.z, s.x, s.z, nearby, Z_RADIUS + 0.05);
    wantX = s.x + a.x * 1.5 + sep.x * 0.8;
    wantZ = s.z + a.z * 1.5 + sep.z * 0.8;
    const len = Math.hypot(wantX, wantZ) || 1;
    wantX = (wantX / len) * z.speed;
    wantZ = (wantZ / len) * z.speed;
  } else if (dist < ATTACK_RANGE) {
    z.state = "ATTACK";
    z.cd -= dt;
    if (z.cd <= 0) {
      z.attacked = true;
      z.cd = ATTACK_COOLDOWN;
      z.lunge = 0.35;
    }
    // hold position but keep spreading so a pack rings the player
    wantX = sep.x * z.speed * 0.5;
    wantZ = sep.z * z.speed * 0.5;
  } else {
    z.state = "CHASE";
    // cooldown still winds down out of range, but never below the floor
    // that stops a drive-by zombie from hitting on the first contact frame
    z.cd = Math.max(0.25, z.cd - dt);
    const s = seek(z.x, z.z, px, pz);
    const a = whiskerAvoid(z.x, z.z, s.x, s.z, nearby, Z_RADIUS + 0.05);
    wantX = s.x + a.x * 1.5 + sep.x * 0.8;
    wantZ = s.z + a.z * 1.5 + sep.z * 0.8;
    const len = Math.hypot(wantX, wantZ) || 1;
    wantX = (wantX / len) * z.speed;
    wantZ = (wantZ / len) * z.speed;
  }

  const k = 1 - Math.exp(-ACCEL * dt);
  z.vx += (wantX - z.vx) * k;
  z.vz += (wantZ - z.vz) * k;
  z.x += z.vx * dt;
  z.z += z.vz * dt;
  z.x = Math.max(-BOUND, Math.min(BOUND, z.x));
  z.z = Math.max(-BOUND, Math.min(BOUND, z.z));

  // hard resolution: two passes settle corner overlaps
  for (let pass = 0; pass < 2; pass++) {
    for (const o of nearby) {
      const p =
        o.minX !== undefined
          ? resolveCircleAabb(z.x, z.z, Z_RADIUS, o)
          : resolveCircleCircle(z.x, z.z, Z_RADIUS, o);
      if (p) {
        z.x += p.x;
        z.z += p.z;
      }
    }
  }
  // never walk through the player
  const pp = resolveCircleCircle(z.x, z.z, Z_RADIUS, { x: px, z: pz, r: 0.45 });
  if (pp) {
    z.x += pp.x;
    z.z += pp.z;
  }

  // face the player in range, otherwise face travel; shortest-arc turn
  const speedH = Math.hypot(z.vx, z.vz);
  const target =
    !z.flee && (dist < ATTACK_RANGE || speedH < 0.2)
      ? Math.atan2(-dx, -dz)
      : Math.atan2(-z.vx, -z.vz);
  let dy = target - z.yaw;
  dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
  z.yaw += dy * Math.min(1, TURN * dt);

  z.phase += dt * (1.6 + speedH * 1.7);
  z.lunge = Math.max(0, z.lunge - dt);
  return z;
}

// hitscan + melee resolution. The ray tests run against analytic zombie
// volumes (vertical body capsule + head sphere), NOT the instanced rig
// meshes - cheaper than raycasting 6 InstancedMeshes and gives headshots.
// These constants are the single source of truth matching ZombieMesh's
// proportions (head center 1.5, torso/leg column).
import { WEAPONS, SLOT_ORDER } from "./WeaponDB.js";

export const HEAD_Y = 1.5;
export const HEAD_R = 0.27;
export const BODY_Y0 = 0.35;
export const BODY_Y1 = 1.3;
export const BODY_R = 0.42;

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const fz = oz - cz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - 4 * c; // a=1 for normalized dir
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / 2;
  return t >= 0 ? t : -1;
}

// vertical capsule: axis x=cx,z=cz, y in [y0,y1], radius r
export function rayCapsule(ox, oy, oz, dx, dy, dz, cx, y0, y1, cz, r) {
  const rx = ox - cx;
  const rz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = 2 * (rx * dx + rz * dz);
    const c = rx * rx + rz * rz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) return t;
      }
    }
  }
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
  if (t0 < 0) return t1;
  if (t1 < 0) return t0;
  return Math.min(t0, t1);
}

// -> { t, head } | null
export function rayZombie(ox, oy, oz, dx, dy, dz, z) {
  const s = z.scale;
  const tH = raySphere(
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    z.x,
    z.y + HEAD_Y * s,
    z.z,
    HEAD_R * s,
  );
  const tB = rayCapsule(
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    z.x,
    z.y + BODY_Y0 * s,
    z.y + BODY_Y1 * s,
    z.z,
    BODY_R * s,
  );
  // head priority: the capsule's top cap pokes into head space, so any
  // head-sphere intersection counts as the headshot (generous, simple)
  if (tH >= 0) return { t: tH, head: true };
  if (tB >= 0) return { t: tB, head: false };
  return null;
}

// nearest living zombie along the ray, within range
export function hitscan(ox, oy, oz, dx, dy, dz, zombies, range) {
  let best = null;
  for (const z of zombies) {
    if (!z.active || z.dying > 0) continue;
    const h = rayZombie(ox, oy, oz, dx, dy, dz, z);
    if (h && h.t <= range && (!best || h.t < best.t)) best = { ...h, z };
  }
  return best;
}

// melee: zombies inside a frontal arc -> sorted nearest-first
export function meleeTargets(px, pz, dirx, dirz, zombies, range, arc) {
  const out = [];
  const cosHalf = Math.cos(arc / 2);
  for (const z of zombies) {
    if (!z.active || z.dying > 0) continue;
    const dx = z.x - px;
    const dz = z.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > range + 0.4) continue; // +zombie radius slack
    if (d > 1e-6 && (dx / d) * dirx + (dz / d) * dirz < cosHalf) continue;
    out.push({ z, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

// aiming down sights tightens the cone
export const aimSpread = (spread, aimT) => spread * (1 - 0.6 * aimT);

// perturb a normalized dir inside a cone (radians); rng in [0,1)
export function spreadDir(dx, dy, dz, spread, rng) {
  if (spread <= 0) return { x: dx, y: dy, z: dz };
  // orthonormal basis around d
  let ux = -dz;
  let uy = 0;
  let uz = dx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uz /= ul;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const su = Math.cos(a) * r;
  const sv = Math.sin(a) * r;
  let x = dx + ux * su + vx * sv;
  let y = dy + uy * su + vy * sv;
  let z = dz + uz * su + vz * sv;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

// browser-side firing controller: consumes input, owns fire-rate/reload
// timers, asks Inventory for rounds, applies damage through Zombies
export class Combat {
  constructor({
    camera,
    player,
    zombies,
    inventory,
    viewModel,
    hud,
    audio,
    particles,
    rng,
  }) {
    this.camera = camera;
    this.player = player;
    this.zombies = zombies;
    this.inventory = inventory;
    this.viewModel = viewModel;
    this.hud = hud;
    this.audio = audio;
    this.particles = particles;
    this.rng = rng;
    this.cd = 0;
    this.reloading = 0;
    this.reloadingId = null; // reload finishes on the weapon that started it
    this.meleeAt = 0; // pending swing impact timer
    this.aimT = 0; // 0..1 aim-down-sights blend (hold RMB)
    this.baseFov = camera.fov;
    this._dir = { x: 0, y: 0, z: 0 };
  }

  startReload() {
    const inv = this.inventory;
    const w = WEAPONS[inv.selected];
    if (w.kind !== "gun" || this.reloading > 0 || !inv.canReload(inv.selected))
      return;
    this.reloading = w.reload;
    this.reloadingId = inv.selected;
    if (this.viewModel) this.viewModel.reload(w.reload);
    if (this.audio) this.audio.reloadClick();
  }

  camDir() {
    // camera rotation is (pitch, yaw, 0, "YXZ"): forward = R * (0,0,-1)
    const p = this.player.pitch;
    const yw = this.player.yaw;
    const d = this._dir;
    d.x = -Math.sin(yw) * Math.cos(p);
    d.y = Math.sin(p);
    d.z = -Math.cos(yw) * Math.cos(p);
    return d;
  }

  fireGun(w) {
    const inv = this.inventory;
    if (!inv.consumeRound(inv.selected)) {
      if (this.audio) this.audio.click(); // dry trigger
      this.startReload(); // empty trigger: auto-reload if there is reserve
      return;
    }
    const o = this.camera.position;
    const d = this.camDir();
    let hits = 0;
    let headshot = false;
    for (let i = 0; i < (w.pellets || 1); i++) {
      const s = spreadDir(
        d.x,
        d.y,
        d.z,
        aimSpread(w.spread, this.aimT),
        this.rng,
      );
      const hit = hitscan(
        o.x,
        o.y,
        o.z,
        s.x,
        s.y,
        s.z,
        this.zombies.active,
        w.range,
      );
      if (!hit) {
        // only the first stray pellet kicks up ground dust (no shotgun spam)
        if (i === 0 && this.particles) {
          const g = this.particles.groundHit(
            o.x,
            o.y,
            o.z,
            s.x,
            s.y,
            s.z,
            w.range,
          );
          if (g) this.particles.dust(g);
        }
        continue;
      }
      hits++;
      headshot ||= hit.head;
      const dmg = w.damage * (hit.head ? w.headMult : 1);
      this.zombies.damage(hit.z, dmg, s.x, s.z, w.knock);
      if (this.particles)
        this.particles.blood(
          { x: o.x + s.x * hit.t, y: o.y + s.y * hit.t, z: o.z + s.z * hit.t },
          s,
        );
    }
    if (hits && this.hud) this.hud.hitmarker(headshot);
    if (this.viewModel) this.viewModel.kick(w.kick);
    if (this.particles && this.viewModel) {
      const mp = this.viewModel.muzzleWorld();
      this.particles.muzzle(mp, d);
      const yw = this.player.yaw;
      this.particles.casing(mp, { x: Math.cos(yw), z: -Math.sin(yw) });
    }
    // braced against the shoulder: aimed shots kick the view less
    this.player.pitch +=
      w.kick * (0.6 + this.rng() * 0.3) * (1 - 0.3 * this.aimT);
    if (this.audio) this.audio.shot(inv.selected);
    this.cd = 1 / w.rate;
  }

  swingMelee(w) {
    if (!this.player.useStamina(w.stamina)) return;
    this.meleeAt = 0.13; // impact lands mid-swing
    if (this.viewModel) this.viewModel.swing();
    if (this.audio) this.audio.swing();
    this.cd = 1 / w.rate;
  }

  resolveMelee(w) {
    const p = this.player.pos;
    const d = this.camDir();
    const len = Math.hypot(d.x, d.z) || 1;
    const targets = meleeTargets(
      p.x,
      p.z,
      d.x / len,
      d.z / len,
      this.zombies.active,
      w.range,
      w.arc,
    );
    // a swing connects with up to 2 zombies
    for (const { z } of targets.slice(0, 2)) {
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      const dd = Math.hypot(dx, dz) || 1;
      this.zombies.damage(z, w.damage, dx / dd, dz / dd, w.knock);
      if (this.particles)
        this.particles.blood(
          {
            x: z.x - (dx / dd) * 0.35,
            y: z.y + 1.0 * z.scale,
            z: z.z - (dz / dd) * 0.35,
          },
          { x: dx / dd, y: 0.35, z: dz / dd },
        );
    }
    if (targets.length) {
      if (this.hud) this.hud.hitmarker(false);
      if (this.audio) this.audio.thwack();
    }
  }

  update(dt, input) {
    const inv = this.inventory;
    this.cd = Math.max(0, this.cd - dt);

    // weapon select: 1-4 + wheel cycling; swapping cancels any reload
    let swapped = false;
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (input.consumePress(`Digit${i + 1}`) && inv.select(i)) swapped = true;
    }
    const wheel = input.consumeWheel();
    if (wheel && inv.cycle(wheel > 0 ? 1 : -1)) swapped = true;
    if (swapped) {
      this.reloading = 0;
      this.reloadingId = null;
      if (this.viewModel) this.viewModel.swapTo(inv.selected);
    }

    const w = WEAPONS[inv.selected];

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        inv.finishReload(this.reloadingId);
        this.reloadingId = null;
        if (this.audio) this.audio.reloadClick();
      }
    } else if (input.consumePress("KeyR")) this.startReload();

    // aim down sights: hold RMB (guns only, not mid-reload); the blend
    // drives viewmodel pose, FOV zoom, spread, and crosshair visibility
    const wantAim =
      w.kind === "gun" && input.mouseDown(2) && this.reloading <= 0;
    this.aimT += ((wantAim ? 1 : 0) - this.aimT) * (1 - Math.exp(-10 * dt));
    if (this.aimT < 0.005) this.aimT = 0;
    else if (this.aimT > 0.995) this.aimT = 1;
    const fov = this.baseFov - 22 * this.aimT;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.viewModel) this.viewModel.aimT = this.aimT;
    if (this.hud) this.hud.setAim(this.aimT > 0.4);

    // pending melee impact
    if (this.meleeAt > 0) {
      this.meleeAt -= dt;
      if (this.meleeAt <= 0) this.resolveMelee(WEAPONS.bat);
    }

    // heal
    if (input.consumePress("KeyQ")) {
      const amt = inv.useHeal();
      if (amt) {
        this.player.heal(amt);
        if (this.hud) this.hud.flashHeal();
      }
    }

    const trigger =
      w.kind === "gun" && w.auto ? input.mouseDown(0) : input.consumeClick(0);
    if (!trigger || this.cd > 0 || this.reloading > 0) return;
    if (w.kind === "melee") this.swingMelee(w);
    else this.fireGun(w);
  }
}

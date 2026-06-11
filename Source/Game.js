// per-frame simulation sequencing + shared state, extracted from Main.js so
// M4/M5 (combat, loot, score) have a single seam to hang off. Main keeps
// rendering/IO: renderer flags, postFx, resize, pointer-lock, overlay.
import * as THREE from "three";
import { DayNightCycle, clockAt } from "./Systems/DayNightCycle.js";
import { WEAPONS } from "./Combat/WeaponDB.js";

const FOG_DAY = new THREE.Color(0xc7cdd6);
const FOG_NIGHT = new THREE.Color(0x121722);
const BEST_KEY = "hordenight.best";

export class Game {
  constructor(systems, onDeath) {
    Object.assign(this, systems);
    this.onDeath = onDeath;
    this.deathFired = false;
    this.forceSim = false; // probes set this to run the sim while unlocked
    this.nightsSurvived = 0;
    this.kills = 0;
    this.lastHealth = this.player.health;
    this.lastPhase = "DAY";
    // the cycle drives every mutable-lighting hook; setBaseSun also
    // invalidates Weather's quiesce cache so fog/exposure re-derive
    this.dayNight = new DayNightCycle((m) => {
      this.weather.setBaseSun(this.sky.setNightMix(m));
      this.weather.baseCol.lerpColors(FOG_DAY, FOG_NIGHT, m);
      this.veg.setNight(m);
    });
  }

  get best() {
    try {
      return +localStorage.getItem(BEST_KEY) || 0;
    } catch {
      return 0;
    }
  }

  // duplicate guns convert to half a mag of their ammo
  collectLoot(loot) {
    const msgs = [];
    for (let { id, n } of loot) {
      if (WEAPONS[id] && this.inventory.unlocked[id]) {
        n = Math.max(4, (WEAPONS[id].mag / 2) | 0);
        id = WEAPONS[id].ammo;
      }
      const m = this.inventory.addItem(id, n);
      if (m) msgs.push(m);
    }
    this.hud.toast(msgs.length ? msgs.join("  ·  ") : "Nothing useful");
  }

  saveBest() {
    try {
      localStorage.setItem(
        BEST_KEY,
        String(Math.max(this.best, this.nightsSurvived)),
      );
    } catch {
      // storage blocked (private mode): score just isn't persisted
    }
  }

  update(dt, elapsed, { locked, indoor }) {
    const p = this.player;
    const run = locked || this.forceSim;
    // fixed order: player -> dayNight -> zombies -> combat -> loot -> hud.
    // combat AFTER zombies so hitscan sees this frame's active list
    if (locked && !p.dead) p.update(dt);
    if (run) {
      const cyc = this.dayNight.update(dt);
      if (cyc.dawned) {
        this.nightsSurvived++;
        this.saveBest(); // progress survives a closed tab
        this.hud.toast(`Dawn — night ${this.dayNight.night} survived`);
      }
      if (cyc.phase === "DUSK" && this.lastPhase === "DAY")
        this.hud.toast("Night is coming…");
      this.lastPhase = cyc.phase;
      this.zombies.update(dt, p, cyc);
    }
    if (run && !p.dead) {
      this.combat.update(dt, this.input);
      const d = this.combat.camDir();
      const r = this.loot.update(dt, {
        px: p.pos.x,
        pz: p.pos.z,
        dx: d.x,
        dz: d.z,
        eHeld: this.input.down("KeyE"),
      });
      this.hud.setPrompt(r.prompt, r.progress);
      if (r.loot) this.collectLoot(r.loot);
      if (this.input.consumePress("Tab"))
        this.hud.toggleInventory(this.inventory);
    }
    this.viewModel.update(
      dt,
      locked ? Math.hypot(p.vel.x, p.vel.z) : 0,
      p.grounded,
    );
    this.particles.update(dt); // cosmetic: keeps settling while paused
    this.weather.update(dt, p.pos, indoor);
    this.water.update(dt);
    this.terrain.update(elapsed);
    this.veg.update(elapsed, p.pos, this.weather.gust);
    const shadowDirty = this.sky.update(p.pos, elapsed);
    this.audio.update(
      dt,
      this.hf.streamDist(p.pos.x, p.pos.z),
      this.weather.visMix,
      this.weather.intensity,
    );

    if (p.health !== this.lastHealth) {
      if (p.health < this.lastHealth) this.hud.flashDamage();
      this.hud.setHealth(p.health / p.maxHealth);
      this.lastHealth = p.health;
    }
    this.hud.setStamina(p.stamina / p.maxStamina);
    this.hud.setHotbar(this.inventory);
    this.hud.setAmmo(this.inventory);
    this.hud.setClock(
      clockAt(this.dayNight.time),
      this.dayNight.phase,
      this.dayNight.night,
    );

    if (p.dead && !this.deathFired) {
      this.deathFired = true;
      this.saveBest();
      this.onDeath();
    }
    return { shadowDirty };
  }
}

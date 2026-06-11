// per-frame simulation sequencing + shared state, extracted from Main.js so
// M4/M5 (combat, day/night, score) have a single seam to hang off. Main
// keeps rendering/IO: renderer flags, postFx, resize, pointer-lock, overlay.
export class Game {
  constructor(systems, onDeath) {
    Object.assign(this, systems);
    this.onDeath = onDeath;
    this.deathFired = false;
    this.forceSim = false; // probes set this to run the sim while unlocked
  }

  update(dt, elapsed, { locked, indoor }) {
    const p = this.player;
    if (locked && !p.dead) p.update(dt);
    if (locked || this.forceSim) this.zombies.update(dt, p);
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
    if (p.dead && !this.deathFired) {
      this.deathFired = true;
      this.onDeath();
    }
    return { shadowDirty };
  }
}

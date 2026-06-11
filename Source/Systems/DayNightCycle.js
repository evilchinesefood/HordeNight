// running day/night clock: pure phase math (Node-tested) + a lighting apply
// hook the Game wires to sky/weather/veg. Score rhythm: DAY loot window ->
// DUSK ramp -> NIGHT horde -> DAWN relief (night counter ticks at dusk,
// "survived" at dawn).
export const DAY_LEN = 240;
export const DUSK_LEN = 24;
export const NIGHT_LEN = 150;
export const DAWN_LEN = 18;
export const CYCLE_LEN = DAY_LEN + DUSK_LEN + NIGHT_LEN + DAWN_LEN;

const STARTS = {
  DAY: 0,
  DUSK: DAY_LEN,
  NIGHT: DAY_LEN + DUSK_LEN,
  DAWN: DAY_LEN + DUSK_LEN + NIGHT_LEN,
};

export function phaseAt(time) {
  const t = ((time % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN;
  if (t < STARTS.DUSK) return { phase: "DAY", f: t / DAY_LEN };
  if (t < STARTS.NIGHT)
    return { phase: "DUSK", f: (t - STARTS.DUSK) / DUSK_LEN };
  if (t < STARTS.DAWN)
    return { phase: "NIGHT", f: (t - STARTS.NIGHT) / NIGHT_LEN };
  return { phase: "DAWN", f: (t - STARTS.DAWN) / DAWN_LEN };
}

// 0 = full day lighting, 1 = full night; ramps across dusk/dawn
export function nightMixAt(time) {
  const { phase, f } = phaseAt(time);
  if (phase === "DAY") return 0;
  if (phase === "DUSK") return f;
  if (phase === "NIGHT") return 1;
  return 1 - f;
}

// 24h wall-clock for the HUD: cycle start = 07:00
export function clockAt(time) {
  const mins =
    (((time % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN) * (1440 / CYCLE_LEN);
  const m = (mins + 7 * 60) % 1440;
  return `${String((m / 60) | 0).padStart(2, "0")}:${String((m % 60) | 0).padStart(2, "0")}`;
}

export class DayNightCycle {
  constructor(apply = null) {
    this.time = 0;
    this.night = 0; // current night number (0 before the first dusk)
    this.phase = "DAY";
    this.apply = apply;
    this.lastMix = -1;
    if (apply) apply(0);
  }

  update(dt) {
    this.time += dt;
    const { phase, f } = phaseAt(this.time);
    let dawned = false;
    if (phase !== this.phase) {
      if (phase === "DUSK" && this.phase === "DAY") this.night++;
      if (phase === "DAWN" && this.phase === "NIGHT") dawned = true;
      this.phase = phase;
    }
    const mix = nightMixAt(this.time);
    if (mix !== this.lastMix) {
      this.lastMix = mix;
      if (this.apply) this.apply(mix);
    }
    return { phase, f, mix, dawned, night: this.night };
  }

  // dev jump: relight immediately (the menu is used while paused)
  jump(phase) {
    const base = Math.floor(this.time / CYCLE_LEN) * CYCLE_LEN;
    const target = base + STARTS[phase];
    this.time = target <= this.time ? target + CYCLE_LEN : target;
    if (phase === "DUSK" || phase === "NIGHT") this.night++;
    this.phase = phase;
    this.lastMix = nightMixAt(this.time);
    if (this.apply) this.apply(this.lastMix);
  }
}

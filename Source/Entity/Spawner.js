// pure spawn cap/cadence + point picking; world clearance is injected so
// this stays Node-testable (and reuses the Placement predicate in the game)

const R_MIN = 28;
const R_MAX = 45;
const TRIES = 14;
// candidates land within +/-VIEW_OFF of straight behind the player: with
// VIEW_OFF = 2pi/3 a forward cone of 120deg never receives a spawn
const VIEW_OFF = (Math.PI * 2) / 3;

export function tick({ active, cap, accum, dt, rate }) {
  let a = accum + dt * rate;
  let spawns = 0;
  if (active < cap) spawns = Math.min(Math.floor(a), cap - active);
  // never bank a burst: at cap (or clamped by it) the residue stays sub-1
  a = Math.min(a - spawns, 1);
  return { spawns, accum: a };
}

// facing: world angle of the player's look direction (atan2(fz, fx)).
// returns {x,z} of the first clear candidate or null when none pass
export function pickSpawnPoint(px, pz, facing, rng, isClear) {
  for (let i = 0; i < TRIES; i++) {
    const a = facing + Math.PI + (rng() * 2 - 1) * VIEW_OFF;
    const r = R_MIN + rng() * (R_MAX - R_MIN);
    const x = px + Math.cos(a) * r;
    const z = pz + Math.sin(a) * r;
    if (isClear(x, z)) return { x, z };
  }
  return null;
}

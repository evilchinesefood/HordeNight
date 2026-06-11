// item ids + weighted loot tables; pure and seed-rollable (Node-tested).
// Weapon ids live in Combat/WeaponDB; ammo ids match Inventory.reserve keys.
export const AMMO_FOR = { pistol: "9mm", shotgun: "shell", rifle: "5.56" };

// n: [min,max] count range for stackables; weapons carry their starter mag
export const LOOT_TABLES = {
  crate: [
    { id: "pistol", w: 3 },
    { id: "shotgun", w: 2 },
    { id: "rifle", w: 2 },
    { id: "9mm", n: [10, 24], w: 4 },
    { id: "shell", n: [4, 10], w: 3 },
    { id: "5.56", n: [12, 30], w: 3 },
    { id: "bandage", n: [1, 2], w: 3 },
  ],
  cabinet: [
    { id: "bandage", n: [1, 3], w: 5 },
    { id: "9mm", n: [8, 16], w: 3 },
    { id: "shell", n: [3, 6], w: 2 },
    { id: "pistol", w: 1 },
  ],
  barrel: [
    { id: "9mm", n: [4, 10], w: 3 },
    { id: "shell", n: [2, 4], w: 2 },
    { id: "5.56", n: [5, 14], w: 3 },
    { id: "bandage", n: [1, 1], w: 2 },
    { id: null, w: 4 }, // junk - barrels are plentiful
  ],
};

// 1-3 weighted draws -> [{id, n}]; deterministic for a given rng stream
export function rollLoot(type, rng) {
  const table = LOOT_TABLES[type];
  const out = [];
  const rolls = 1 + ((rng() * 3) | 0);
  for (let i = 0; i < rolls; i++) {
    const total = table.reduce((s, e) => s + e.w, 0);
    let pick = rng() * total;
    const e = table.find((e) => (pick -= e.w) < 0) ?? table[0];
    if (!e.id) continue;
    out.push({
      id: e.id,
      n: e.n ? e.n[0] + ((rng() * (e.n[1] - e.n[0] + 1)) | 0) : 1,
    });
  }
  return out;
}

// camera-facing candidate filter: nearest unsearched container in reach
// that the player is actually looking toward
export function nearestSearchable(list, px, pz, dx, dz, reach = 2.6) {
  let best = null;
  for (const c of list) {
    if (c.searched) continue;
    const ox = c.x - px;
    const oz = c.z - pz;
    const d = Math.hypot(ox, oz);
    if (d > reach) continue;
    const hl = Math.hypot(dx, dz) || 1;
    if (d > 0.4 && (ox / d) * (dx / hl) + (oz / d) * (dz / hl) < 0.72) continue;
    if (!best || d < best.d) best = { c, d };
  }
  return best ? best.c : null;
}

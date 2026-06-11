// pure inventory/hotbar state: weapon slots 1-4 unlocked as found, per-type
// ammo reserves, per-weapon mags, heal counter. No DOM, no three - tested.
import { WEAPONS, SLOT_ORDER } from "../Combat/WeaponDB.js";

export const HEAL_AMOUNT = 35;

export class Inventory {
  constructor() {
    this.unlocked = { bat: true, pistol: false, shotgun: false, rifle: false };
    this.mag = { pistol: 0, shotgun: 0, rifle: 0 };
    this.reserve = { "9mm": 0, shell: 0, 5.56: 0 };
    this.heals = 0;
    this.selected = "bat";
  }

  // weapon id, ammo type, or "bandage" -> human summary for the HUD toast
  addItem(id, n = 1) {
    if (WEAPONS[id]) {
      const first = !this.unlocked[id];
      this.unlocked[id] = true;
      if (first && WEAPONS[id].kind === "gun") this.mag[id] = WEAPONS[id].mag;
      return first ? `${WEAPONS[id].name}!` : null;
    }
    if (id === "bandage") {
      this.heals += n;
      return `+${n} Bandage${n > 1 ? "s" : ""}`;
    }
    if (id in this.reserve) {
      this.reserve[id] += n;
      return `+${n} ${id}`;
    }
    return null;
  }

  select(slotIdx) {
    const id = SLOT_ORDER[slotIdx];
    if (!id || !this.unlocked[id] || this.selected === id) return false;
    this.selected = id;
    return true;
  }

  cycle(dir) {
    const cur = SLOT_ORDER.indexOf(this.selected);
    for (let k = 1; k <= SLOT_ORDER.length; k++) {
      const i = (cur + dir * k + SLOT_ORDER.length * k) % SLOT_ORDER.length;
      if (this.unlocked[SLOT_ORDER[i]]) return this.select(i);
    }
    return false;
  }

  consumeRound(id) {
    if (WEAPONS[id]?.kind !== "gun") return true; // melee never consumes
    if (this.mag[id] <= 0) return false;
    this.mag[id]--;
    return true;
  }

  canReload(id) {
    const w = WEAPONS[id];
    return (
      w?.kind === "gun" && this.mag[id] < w.mag && this.reserve[w.ammo] > 0
    );
  }

  finishReload(id) {
    const w = WEAPONS[id];
    if (!this.canReload(id) && this.mag[id] >= w.mag) return;
    const take = Math.min(w.mag - this.mag[id], this.reserve[w.ammo]);
    this.mag[id] += take;
    this.reserve[w.ammo] -= take;
  }

  useHeal() {
    if (this.heals <= 0) return 0;
    this.heals--;
    return HEAL_AMOUNT;
  }
}

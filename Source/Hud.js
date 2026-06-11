// in-game HUD: bars, clock, crosshair/hitmarker, hotbar/ammo, loot prompt,
// Tab inventory panel. DOM lives in Index.html; this only mutates it.
import { WEAPONS, SLOT_ORDER } from "./Combat/WeaponDB.js";

export class Hud {
  constructor() {
    this.fill = document.getElementById("HealthFill");
    this.stamFill = document.getElementById("StaminaFill");
    this.flash = document.getElementById("DamageFlash");
    this.clockTime = document.getElementById("ClockTime");
    this.clockNight = document.getElementById("ClockNight");
    this.hitEl = document.getElementById("HitMarker");
    this.promptEl = document.getElementById("Prompt");
    this.promptText = document.getElementById("PromptText");
    this.promptFill = document.getElementById("PromptFill");
    this.toastEl = document.getElementById("Toast");
    this.hotbarEl = document.getElementById("Hotbar");
    this.ammoEl = document.getElementById("Ammo");
    this.invPanel = document.getElementById("InvPanel");
    this.lowEl = document.getElementById("LowHealth");
    this.deathEl = document.getElementById("DeathScreen");
    this.lastClock = "";
    this.lastHotbar = "";
    this.lastAmmo = "";
    this.lastPrompt = "";
    this.hitTimer = 0;
    this.toastTimer = 0;
    this.invOpen = false;
  }

  setPrompt(text, frac = 0) {
    if (!this.promptEl) return;
    const key = (text || "") + ((frac * 40) | 0);
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.promptEl.style.display = text ? "block" : "none";
    if (text) {
      this.promptText.textContent = text;
      this.promptFill.style.width = `${frac * 100}%`;
    }
  }

  toast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("Show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => this.toastEl.classList.remove("Show"),
      2200,
    );
  }

  setHotbar(inv) {
    if (!this.hotbarEl) return;
    const key =
      SLOT_ORDER.map((id) => (inv.unlocked[id] ? 1 : 0)).join("") +
      inv.selected;
    if (key === this.lastHotbar) return;
    this.lastHotbar = key;
    this.hotbarEl.innerHTML = SLOT_ORDER.map((id, i) => {
      const cls =
        "Slot" +
        (inv.unlocked[id] ? "" : " Locked") +
        (inv.selected === id ? " Active" : "");
      return `<span class="${cls}">${i + 1} ${WEAPONS[id].name}</span>`;
    }).join("");
  }

  setAmmo(inv) {
    if (!this.ammoEl) return;
    const w = WEAPONS[inv.selected];
    const ammo =
      w.kind === "gun"
        ? `${inv.mag[inv.selected]} / ${inv.reserve[w.ammo]}`
        : "";
    const key = ammo + "+" + inv.heals;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.ammoEl.innerHTML =
      (ammo ? `<span id="AmmoCount">${ammo}</span>` : "") +
      `<span id="HealCount">[Q] &#10010; ${inv.heals}</span>`;
  }

  toggleInventory(inv) {
    if (!this.invPanel) return;
    this.invOpen = !this.invOpen;
    this.invPanel.classList.toggle("Off", !this.invOpen);
    if (!this.invOpen) return;
    const rows = SLOT_ORDER.filter((id) => inv.unlocked[id]).map((id) => {
      const w = WEAPONS[id];
      const extra =
        w.kind === "gun"
          ? ` — ${inv.mag[id]} in mag, ${inv.reserve[w.ammo]} ${w.ammo}`
          : "";
      return `<li>${w.name}${extra}</li>`;
    });
    rows.push(`<li>Bandages — ${inv.heals}</li>`);
    this.invPanel.innerHTML = `<h3>Carried</h3><ul>${rows.join("")}</ul>`;
  }

  setStamina(frac) {
    if (this.stamFill)
      this.stamFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  hitmarker(head) {
    if (!this.hitEl) return;
    this.hitEl.className = head ? "Show Head" : "Show";
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => (this.hitEl.className = ""), 110);
  }

  flashHeal() {
    if (!this.fill) return;
    this.fill.style.filter = "brightness(2)";
    setTimeout(() => (this.fill.style.filter = ""), 280);
  }

  setClock(time, phase, night) {
    const key = time + phase + night;
    if (key === this.lastClock || !this.clockTime) return;
    this.lastClock = key;
    this.clockTime.textContent = time;
    const dark = phase === "NIGHT" || phase === "DUSK";
    this.clockTime.style.color = dark ? "#9fb4dd" : "#e8e4d8";
    this.clockNight.textContent = night > 0 ? `Night ${night}` : "";
  }

  setHealth(frac) {
    const f = Math.max(0, Math.min(1, frac));
    if (this.fill) this.fill.style.width = `${f * 100}%`;
    if (this.lowEl)
      this.lowEl.style.opacity = f < 0.3 ? ((0.3 - f) / 0.3) * 0.75 : 0;
  }

  showDeath(nights, best) {
    if (!this.deathEl) return;
    const n = (k) => `${k} night${k === 1 ? "" : "s"}`;
    document.getElementById("DeathNights").textContent =
      `You survived ${n(nights)}`;
    document.getElementById("DeathBest").textContent = `Best: ${n(best)}`;
    this.deathEl.classList.remove("Off");
  }

  flashDamage() {
    const el = this.flash;
    if (!el) return;
    el.style.transition = "none";
    el.style.opacity = "0.85";
    void el.offsetWidth; // restart the fade even mid-transition
    el.style.transition = "opacity 0.55s ease";
    el.style.opacity = "0";
  }

  flashDeath() {
    const el = this.flash;
    if (!el) return;
    el.classList.add("Death");
    el.style.transition = "opacity 0.45s ease";
    el.style.opacity = "1";
  }
}

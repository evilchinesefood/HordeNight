// placeholder HUD for M3: health bar + red damage/death flash. Full HUD
// (score, night counter, death screen) is M5.
export class Hud {
  constructor() {
    this.fill = document.getElementById("HealthFill");
    this.stamFill = document.getElementById("StaminaFill");
    this.flash = document.getElementById("DamageFlash");
    this.clockTime = document.getElementById("ClockTime");
    this.clockNight = document.getElementById("ClockNight");
    this.hitEl = document.getElementById("HitMarker");
    this.lastClock = "";
    this.hitTimer = 0;
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
    if (this.fill)
      this.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
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

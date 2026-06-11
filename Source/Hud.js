// placeholder HUD for M3: health bar + red damage/death flash. Full HUD
// (score, night counter, death screen) is M5.
export class Hud {
  constructor() {
    this.fill = document.getElementById("HealthFill");
    this.flash = document.getElementById("DamageFlash");
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

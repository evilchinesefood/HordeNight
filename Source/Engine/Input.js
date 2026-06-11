export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.presses = new Set(); // one-shot keydowns, consumed by gameplay
    this.mouse = new Set();
    this.clicks = new Set(); // one-shot mousedowns
    this.wheel = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.onLockChange = null;

    document.addEventListener("keydown", (e) => {
      if (this.locked && (e.code === "Space" || e.code === "Tab"))
        e.preventDefault();
      if (!e.repeat) this.presses.add(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      this.mouse.add(e.button);
      this.clicks.add(e.button);
    });
    document.addEventListener("mouseup", (e) => this.mouse.delete(e.button));
    document.addEventListener(
      "wheel",
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    this._look = [0, 0];
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // clamp: some Chrome builds spike movementX on the first post-lock event
      this.lookX += Math.max(-200, Math.min(200, e.movementX));
      this.lookY += Math.max(-200, Math.min(200, e.movementY));
    });
    document.addEventListener("pointerlockerror", () => {
      // Chrome rejects re-lock within ~1.5s of an Escape exit; retry once.
      // The retry never re-arms, so persistent denial (iframe policy,
      // mobile) stops here instead of looping forever
      if (!this.retryArmed) return;
      this.retryArmed = false;
      setTimeout(() => this.lock(true), 1300);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      this.keys.clear();
      this.presses.clear();
      this.mouse.clear();
      this.clicks.clear();
      this.wheel = 0;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock(isRetry = false) {
    try {
      if (!isRetry) this.retryArmed = true;
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // pointerlockerror handles retry
    } catch {
      // pointer lock unsupported (touch devices)
    }
  }

  consumeLook() {
    const out = this._look;
    out[0] = this.lookX;
    out[1] = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  down(code) {
    return this.keys.has(code);
  }

  consumePress(code) {
    const had = this.presses.has(code);
    this.presses.delete(code);
    return had;
  }

  mouseDown(b = 0) {
    return this.mouse.has(b);
  }

  consumeClick(b = 0) {
    const had = this.clicks.has(b);
    this.clicks.delete(b);
    return had;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}

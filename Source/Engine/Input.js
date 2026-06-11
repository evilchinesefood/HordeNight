export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.onLockChange = null;

    document.addEventListener("keydown", (e) => {
      if (this.locked && e.code === "Space") e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
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
}

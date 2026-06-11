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
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener("pointerlockerror", () => {
      // Chrome rejects re-lock within ~1.5s of an Escape exit; retry once
      if (!this.retryArmed) return;
      this.retryArmed = false;
      setTimeout(() => this.lock(), 1300);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      this.retryArmed = true;
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // pointerlockerror handles retry
    } catch {
      // pointer lock unsupported (touch devices)
    }
  }

  consumeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return [x, y];
  }

  down(code) {
    return this.keys.has(code);
  }
}

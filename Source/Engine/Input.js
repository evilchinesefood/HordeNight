export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.onLockChange = null;

    document.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    this.dom.requestPointerLock();
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

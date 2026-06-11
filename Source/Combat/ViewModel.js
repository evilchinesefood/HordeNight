// procedural first-person weapon rig: boxes only, attached to the camera
// (Main adds the camera to the scene so children render). All parts live on
// layer 2 - AO override passes would smear a near-camera mesh - and never
// cast shadows.
import * as THREE from "three";

const VM_LAYER = 2;
const BASE_POS = new THREE.Vector3(0.27, -0.25, -0.5);

function flashTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,240,200,1)");
  grad.addColorStop(0.4, "rgba(255,180,80,0.85)");
  grad.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = false;
  return tex;
}

export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.position.copy(BASE_POS);
    camera.add(this.group);

    const wood = new THREE.MeshStandardMaterial({
      color: 0x6e4a2f,
      roughness: 0.85,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x3a3d42,
      roughness: 0.55,
      metalness: 0.55,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x23262b,
      roughness: 0.7,
      metalness: 0.3,
    });
    const box = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.layers.set(VM_LAYER);
      return m;
    };
    const model = (parts, muzzleZ) => {
      const g = new THREE.Group();
      for (const p of parts) g.add(p);
      g.visible = false;
      g.userData.muzzleZ = muzzleZ;
      this.group.add(g);
      return g;
    };

    this.models = {
      bat: model(
        [
          box(0.05, 0.05, 0.55, 0, 0, -0.2, wood),
          box(0.075, 0.075, 0.3, 0, 0, -0.42, wood),
          box(0.06, 0.06, 0.06, 0, 0, 0.08, dark),
        ],
        0,
      ),
      pistol: model(
        [
          box(0.05, 0.09, 0.22, 0, 0.02, -0.1, metal),
          box(0.045, 0.13, 0.06, 0, -0.06, 0.0, dark),
          box(0.03, 0.03, 0.1, 0, 0.045, -0.18, metal),
        ],
        -0.24,
      ),
      shotgun: model(
        [
          box(0.05, 0.06, 0.62, 0, 0.02, -0.25, metal),
          box(0.05, 0.05, 0.3, 0, -0.045, -0.3, wood),
          box(0.06, 0.11, 0.22, 0, -0.03, 0.05, wood),
        ],
        -0.58,
      ),
      rifle: model(
        [
          box(0.05, 0.08, 0.5, 0, 0.01, -0.18, dark),
          box(0.04, 0.04, 0.3, 0, 0.035, -0.42, metal),
          box(0.04, 0.16, 0.07, 0, -0.1, -0.05, metal),
          box(0.05, 0.07, 0.16, 0, -0.01, 0.14, wood),
        ],
        -0.6,
      ),
    };

    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        map: flashTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flashMesh.layers.set(VM_LAYER);
    this.flashMesh.visible = false;
    this.group.add(this.flashMesh);
    this.flashLight = new THREE.PointLight(0xffc97a, 0, 9, 1.6);
    this.group.add(this.flashLight);

    this.current = "bat";
    this.models.bat.visible = true;
    this.recoil = 0;
    this.swingT = 0;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.swapT = 0;
    this.flashT = 0;
    this.bob = 0;
  }

  swapTo(id) {
    if (id === this.current) return;
    this.next = id;
    this.swapT = 0.3; // lower 0.15, switch, raise 0.15
  }

  kick(k) {
    this.recoil = Math.min(1, this.recoil + k * 22);
    this.flashT = 0.05;
    const mz = this.models[this.current].userData.muzzleZ;
    if (mz < 0) {
      this.flashMesh.position.set(0, 0.02, mz - 0.06);
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      this.flashMesh.visible = true;
      this.flashLight.position.set(0, 0.02, mz);
      this.flashLight.intensity = 14;
    }
  }

  swing() {
    this.swingT = 0.32;
  }

  reload(dur) {
    this.reloadDur = dur;
    this.reloadT = dur;
  }

  update(dt, moveSpeed, grounded) {
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.next && this.swapT <= 0.15) {
        this.models[this.current].visible = false;
        this.current = this.next;
        this.models[this.current].visible = true;
        this.next = null;
      }
      if (this.swapT < 0) this.swapT = 0;
    }
    this.recoil *= Math.exp(-9 * dt);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashMesh.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    if (grounded && moveSpeed > 0.5) this.bob += dt * (4 + moveSpeed * 0.9);

    const g = this.group;
    const bobA = Math.min(moveSpeed / 5.2, 1.4) * 0.012;
    // swap dip: 1 at the bottom of the lower/raise vee
    const swapDip = this.swapT > 0 ? 1 - Math.abs(this.swapT - 0.15) / 0.15 : 0;
    // reload: dip + roll while the timer runs
    const rl =
      this.reloadT > 0
        ? Math.sin((1 - this.reloadT / this.reloadDur) * Math.PI)
        : 0;
    g.position.set(
      BASE_POS.x + Math.sin(this.bob) * bobA,
      BASE_POS.y +
        Math.abs(Math.cos(this.bob)) * bobA * 0.8 -
        swapDip * 0.3 -
        rl * 0.12,
      BASE_POS.z + this.recoil * 0.09,
    );
    // melee swing: wind back then arc across
    let swingRotX = 0;
    let swingRotY = 0;
    if (this.swingT > 0) {
      const st = 1 - this.swingT / 0.32;
      const arc = Math.sin(st * Math.PI);
      swingRotX = -arc * 1.1;
      swingRotY = (st - 0.5) * 1.2;
    }
    g.rotation.set(
      this.recoil * 0.35 + swingRotX - rl * 0.7,
      swingRotY,
      rl * 0.4,
    );
  }
}

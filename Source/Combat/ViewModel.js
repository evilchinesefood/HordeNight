// procedural first-person weapon rig. Each gun is 12-18 boxes, but the
// static ones merge into ONE geometry per material (<=3 draw calls per
// weapon, only the selected one visible) plus a single animated mover
// (pistol slide, shotgun pump). All parts live on layer 2 - AO override
// passes would smear a near-camera mesh - and never cast shadows.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const VM_LAYER = 2;
const BASE_POS = new THREE.Vector3(0.27, -0.25, -0.5);
const PUMP_DELAY = 0.12;
const PUMP_DUR = 0.45;

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

const box = (arr, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  arr.push(g.translate(x, y, z));
};
// octagonal column: two boxes, one turned 45deg (bat segments)
const oct = (arr, r, len, z) => {
  box(arr, r * 2, r * 2, len, 0, 0, z);
  box(arr, r * 2, r * 2, len, 0, 0, z, 0, 0, Math.PI / 4);
};

export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.position.copy(BASE_POS);
    camera.add(this.group);

    this.mats = {
      wood: new THREE.MeshStandardMaterial({
        color: 0x6e4a2f,
        roughness: 0.85,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: 0x3a3d42,
        roughness: 0.45,
        metalness: 0.65,
      }),
      dark: new THREE.MeshStandardMaterial({
        color: 0x23262b,
        roughness: 0.7,
        metalness: 0.3,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: 0xc9a04a,
        roughness: 0.35,
        metalness: 0.85,
      }),
    };

    this.models = {
      bat: this._bat(),
      pistol: this._pistol(),
      shotgun: this._shotgun(),
      rifle: this._rifle(),
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
    this.slideT = 0;
    this.pumpT = 0;
    this._mw = new THREE.Vector3();
  }

  // assemble: static geos merged per material + optional mover mesh
  _model(byMat, mover, muzzle, rot) {
    const g = new THREE.Group();
    for (const key of Object.keys(byMat)) {
      if (!byMat[key].length) continue;
      const m = new THREE.Mesh(mergeGeometries(byMat[key]), this.mats[key]);
      m.layers.set(VM_LAYER);
      g.add(m);
    }
    if (mover) {
      const m = new THREE.Mesh(
        mergeGeometries(mover.geos),
        this.mats[mover.mat],
      );
      m.layers.set(VM_LAYER);
      g.add(m);
      g.userData.mover = m;
    }
    if (muzzle) g.userData.muzzle = muzzle;
    if (rot) g.rotation.set(rot.x, rot.y, rot.z);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  _bat() {
    const wood = [];
    const dark = [];
    oct(wood, 0.022, 0.2, 0.06);
    oct(wood, 0.03, 0.26, -0.16);
    oct(wood, 0.042, 0.3, -0.43);
    oct(wood, 0.044, 0.06, -0.6);
    for (const z of [0.02, 0.055, 0.09]) box(dark, 0.052, 0.052, 0.03, 0, 0, z);
    box(dark, 0.062, 0.062, 0.035, 0, 0, 0.14); // knob
    return this._model({ wood, dark }, null, null, {
      x: -0.1,
      y: -0.12,
      z: 0.5,
    });
  }

  _pistol() {
    const dark = [];
    const metal = [];
    box(dark, 0.046, 0.13, 0.07, 0, -0.075, 0.02, -0.18); // raked grip
    box(dark, 0.05, 0.022, 0.075, 0, -0.146, 0.025); // mag base
    box(dark, 0.012, 0.012, 0.055, 0, -0.052, -0.015); // guard bottom
    box(dark, 0.012, 0.04, 0.012, 0, -0.033, -0.043); // guard front
    box(dark, 0.008, 0.026, 0.008, 0, -0.04, -0.008); // trigger
    box(metal, 0.048, 0.04, 0.2, 0, -0.008, -0.05); // frame
    box(metal, 0.02, 0.012, 0.04, 0, -0.026, -0.135); // rail nub
    const slide = [];
    box(slide, 0.052, 0.044, 0.21, 0, 0.036, -0.05);
    box(slide, 0.01, 0.02, 0.014, 0, 0.068, -0.145); // front sight
    box(slide, 0.034, 0.016, 0.014, 0, 0.066, 0.045); // rear sight
    const g = this._model(
      { dark, metal },
      { geos: slide, mat: "metal" },
      new THREE.Vector3(0, 0.034, -0.165),
    );
    g.position.set(-0.01, 0.05, 0.12); // pistols are small: hold closer/higher
    return g;
  }

  _shotgun() {
    const metal = [];
    const wood = [];
    const dark = [];
    const brass = [];
    box(metal, 0.034, 0.034, 0.56, 0, 0.04, -0.3); // barrel
    box(metal, 0.028, 0.028, 0.48, 0, -0.004, -0.27); // mag tube
    box(metal, 0.054, 0.08, 0.17, 0, 0.014, 0.01); // receiver
    box(metal, 0.009, 0.014, 0.009, 0, 0.064, -0.57); // bead sight
    box(metal, 0.012, 0.012, 0.06, 0, -0.045, 0.02); // guard bottom
    box(metal, 0.012, 0.036, 0.012, 0, -0.028, 0.05); // guard front
    box(wood, 0.05, 0.08, 0.26, 0, -0.03, 0.18, 0.14); // stock
    box(wood, 0.05, 0.06, 0.08, 0, -0.012, 0.08); // wrist
    box(dark, 0.054, 0.085, 0.025, 0, -0.055, 0.31); // buttpad
    for (let i = 0; i < 3; i++)
      box(brass, 0.018, 0.018, 0.058, 0.038, 0.052 - i * 0.026, 0.02); // shell holder
    const pump = [];
    box(pump, 0.046, 0.042, 0.15, 0, -0.004, -0.36);
    for (const z of [-0.315, -0.36, -0.405])
      box(pump, 0.052, 0.048, 0.014, 0, -0.004, z); // grip ribs
    return this._model(
      { metal, wood, dark, brass },
      { geos: pump, mat: "wood" },
      new THREE.Vector3(0, 0.04, -0.585),
    );
  }

  _rifle() {
    const dark = [];
    const metal = [];
    const wood = [];
    box(dark, 0.05, 0.07, 0.26, 0, 0.005, -0.02); // receiver
    box(dark, 0.054, 0.058, 0.2, 0, 0.008, -0.24); // handguard
    box(dark, 0.042, 0.1, 0.05, 0, -0.082, 0.06, -0.3); // pistol grip
    box(dark, 0.044, 0.13, 0.07, 0, -0.095, -0.07, 0.3); // magazine
    box(dark, 0.044, 0.09, 0.06, 0, -0.165, -0.105, 0.55); // mag curve
    box(dark, 0.05, 0.08, 0.02, 0, -0.012, 0.29); // buttpad
    box(metal, 0.026, 0.026, 0.18, 0, 0.014, -0.43); // barrel
    box(metal, 0.036, 0.036, 0.055, 0, 0.014, -0.545); // muzzle device
    box(metal, 0.014, 0.05, 0.018, 0, 0.058, -0.38); // front sight post
    box(metal, 0.032, 0.018, 0.05, 0, 0.062, 0.02); // rear sight
    box(metal, 0.05, 0.014, 0.045, 0, 0.052, 0.07); // charging handle
    box(metal, 0.012, 0.02, 0.12, 0.034, 0.01, -0.24); // side rail
    box(wood, 0.046, 0.07, 0.2, 0, -0.012, 0.18, 0.06); // stock
    return this._model(
      { dark, metal, wood },
      null,
      new THREE.Vector3(0, 0.014, -0.57),
    );
  }

  // world-space muzzle tip for particles/casings (bat: in front of hands)
  muzzleWorld() {
    const g = this.models[this.current];
    const out = this._mw;
    if (g.userData.muzzle) out.copy(g.userData.muzzle);
    else out.set(0, 0, -0.4);
    g.updateWorldMatrix(true, false);
    return out.applyMatrix4(g.matrixWorld);
  }

  swapTo(id) {
    if (id === this.current) return;
    this.next = id;
    this.swapT = 0.3; // lower 0.15, switch, raise 0.15
  }

  kick(k) {
    this.recoil = Math.min(1, this.recoil + k * 22);
    this.flashT = 0.05;
    if (this.current === "pistol") this.slideT = 1;
    if (this.current === "shotgun") this.pumpT = PUMP_DELAY + PUMP_DUR;
    const model = this.models[this.current];
    const mz = model.userData.muzzle;
    if (mz) {
      // muzzle is in model space; the flash lives on the group, so fold in
      // any per-model hold offset
      this.flashMesh.position.copy(mz).add(model.position);
      this.flashMesh.position.z -= 0.06;
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      this.flashMesh.visible = true;
      this.flashLight.position.copy(mz).add(model.position);
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
    this.slideT *= Math.exp(-12 * dt);
    if (this.pumpT > 0) this.pumpT = Math.max(0, this.pumpT - dt);
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

    // animated mover: pistol slide recoils, shotgun pump racks after a beat
    const mover = this.models[this.current].userData.mover;
    if (mover) {
      let off = 0;
      if (this.current === "pistol") off = this.slideT * 0.05;
      else if (this.current === "shotgun" && this.pumpT < PUMP_DUR)
        off = Math.sin((1 - this.pumpT / PUMP_DUR) * Math.PI) * 0.085;
      mover.position.z = off;
    }

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

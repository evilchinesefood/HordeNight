// instanced low-poly zombie rig: 10 sculpted body parts (merged multi-box
// geometry each) + a blob shadow, so a full horde costs ~11 draw calls.
// Limbs articulate at shoulder/elbow and hip/knee; per-zombie bulk/hunch/
// gait come from spawn state and cost nothing (matrix scaling). castShadow
// stays off to keep shadowMap.autoUpdate=false intact - the blob fakes
// grounding.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DEATH_T } from "./Zombie.js";

const LUNGE_T = 0.35; // matches Zombie.js lunge timer
// head pivot height (x scale) - Combat's analytic head sphere sits here;
// RunAll asserts this stays equal to Combat.HEAD_Y
export const HEAD_PIVOT_Y = 1.5;

// build a box already rotated then placed relative to the part pivot
function geoBox(w, h, d, x, y, z, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}

const PARTS = {
  torso: [
    geoBox(0.56, 0.42, 0.32, 0, 0.1, 0), // ribcage
    geoBox(0.48, 0.24, 0.28, 0, -0.24, 0.01), // pelvis
    geoBox(0.4, 0.24, 0.16, 0, 0.24, 0.13), // hunched upper back
    geoBox(0.18, 0.16, 0.025, -0.15, -0.38, -0.1, 0, 0.25), // torn hem
    geoBox(0.16, 0.14, 0.025, 0.13, -0.36, -0.12, 0, -0.3),
    geoBox(0.18, 0.15, 0.025, 0.02, -0.37, 0.14, 0, 0.1),
  ],
  head: [
    geoBox(0.3, 0.27, 0.3, 0, 0.045, 0.01), // cranium
    geoBox(0.22, 0.11, 0.22, 0, -0.12, -0.03, 0.22), // slack jaw
    geoBox(0.31, 0.06, 0.1, 0, 0.06, -0.14), // brow
    geoBox(0.05, 0.07, 0.07, 0, -0.03, -0.17), // nose
  ],
  upperArm: [
    geoBox(0.2, 0.14, 0.2, 0, -0.01, 0), // shoulder
    geoBox(0.155, 0.34, 0.155, 0, -0.17, 0),
  ],
  forearm: [
    geoBox(0.13, 0.3, 0.13, 0, -0.15, 0),
    geoBox(0.135, 0.13, 0.17, 0, -0.33, -0.02), // hand, fingers forward
  ],
  thigh: [geoBox(0.19, 0.48, 0.2, 0, -0.22, 0)],
  shin: [
    geoBox(0.16, 0.44, 0.17, 0, -0.22, 0),
    geoBox(0.155, 0.1, 0.28, 0, -0.47, -0.05), // foot
  ],
};

export class ZombieMesh {
  constructor(capacity) {
    this.capacity = capacity;
    this.group = new THREE.Group();
    // material stays white: setColorAt multiplies material color (M1 gotcha)
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const cloth = new THREE.MeshStandardMaterial({ roughness: 1 });
    const part = (key, mat) => {
      const m = new THREE.InstancedMesh(
        mergeGeometries(PARTS[key].map((g) => g.clone())),
        mat,
        capacity,
      );
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.torso = part("torso", cloth);
    this.head = part("head", skin);
    this.upArmL = part("upperArm", cloth); // sleeves
    this.upArmR = part("upperArm", cloth);
    this.foreL = part("forearm", skin);
    this.foreR = part("forearm", skin);
    this.thighL = part("thigh", cloth);
    this.thighR = part("thigh", cloth);
    this.shinL = part("shin", cloth);
    this.shinR = part("shin", cloth);
    this.parts = [
      this.torso,
      this.head,
      this.upArmL,
      this.upArmR,
      this.foreL,
      this.foreR,
      this.thighL,
      this.thighR,
      this.shinL,
      this.shinR,
    ];
    this.skinParts = [this.head, this.foreL, this.foreR];
    this.clothParts = [
      this.torso,
      this.upArmL,
      this.upArmR,
      this.thighL,
      this.thighR,
      this.shinL,
      this.shinR,
    ];

    const blobGeo = new THREE.CircleGeometry(0.62, 18).rotateX(-Math.PI / 2);
    this.blob = new THREE.InstancedMesh(
      blobGeo,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
      capacity,
    );
    this.blob.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blob.frustumCulled = false;
    this.blob.layers.set(2); // AO-excluded: override materials ignore blending
    this.blob.renderOrder = 2;
    this.group.add(this.blob);

    this._d = new THREE.Object3D();
    this._root = new THREE.Matrix4();
    this._m1 = new THREE.Matrix4(); // chain parent (upper arm / thigh)
    this._tmp = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._c = new THREE.Color();
    // instanceColor must exist before the boot compileAsync: created lazily
    // at first spawn it would force a program switch mid-session
    this._c.setRGB(1, 1, 1);
    for (let i = 0; i < capacity; i++) {
      for (const m of this.parts) {
        m.setMatrixAt(i, this._zero);
        m.setColorAt(i, this._c);
      }
      this.blob.setMatrixAt(i, this._zero);
    }
  }

  // colors come from z.skin/z.cloth each frame so the hit-flash can whiten
  _tint(i, rgb, f, meshes) {
    this._c.setRGB(
      rgb[0] + (1 - rgb[0]) * f,
      rgb[1] + (1 - rgb[1]) * f,
      rgb[2] + (1 - rgb[2]) * f,
    );
    for (const m of meshes) m.setColorAt(i, this._c);
  }

  // compose pivot * local under parent; returns the shared tmp matrix
  _part(mesh, i, parent, px, py, pz, rx, rz, sx = 1, sz = sx) {
    const d = this._d;
    d.position.set(px, py, pz);
    d.rotation.set(rx, 0, rz, "YXZ");
    d.scale.set(sx, 1, sz);
    d.updateMatrix();
    this._tmp.multiplyMatrices(parent, d.matrix);
    mesh.setMatrixAt(i, this._tmp);
    return this._tmp;
  }

  write(pool) {
    const d = this._d;
    for (let i = 0; i < pool.length; i++) {
      const z = pool[i];
      if (!z || !z.active) {
        for (const m of this.parts) m.setMatrixAt(i, this._zero);
        this.blob.setMatrixAt(i, this._zero);
        continue;
      }
      // topple backward over the feet, then sink under the turf
      const dieT = z.dying > 0 ? Math.min(z.dying / 0.55, 1) : 0;
      const sink =
        z.dying > 0 ? Math.max(0, (z.dying - 0.85) / (DEATH_T - 0.85)) : 0;
      d.position.set(z.x, z.y - sink * 1.1, z.z);
      d.rotation.set(dieT * 1.5, z.yaw, 0, "YXZ");
      d.scale.setScalar(z.scale);
      d.updateMatrix();
      this._root.copy(d.matrix);

      const f = Math.min(1, z.flash * 9);
      if (z.skin) this._tint(i, z.skin, f, this.skinParts);
      if (z.cloth) this._tint(i, z.cloth, f, this.clothParts);

      const bulk = z.bulk ?? 1;
      const limb = 0.75 + bulk * 0.25;
      const hunch = (z.hunch ?? 0.16) + (z.lunge / LUNGE_T) * 0.12;
      const gait = z.gait ?? 1;
      const lunge = z.lunge / LUNGE_T;
      const swing = Math.sin(z.phase) * 0.5 * gait;
      const bob = Math.sin(z.phase * 2) * 0.025;

      this._part(this.torso, i, this._root, 0, 1.04 + bob, 0, hunch, 0, bulk);
      this._part(
        this.head,
        i,
        this._root,
        0,
        HEAD_PIVOT_Y + bob - 0.01,
        -0.02 - hunch * 0.12,
        0.1 - hunch * 0.3,
        Math.sin(z.phase) * 0.07,
      );

      // arms: raised forward, forearms drooping at the elbow; lunge extends
      const armRaise = 1.1 + lunge * 0.45;
      const armSway = Math.sin(z.phase) * 0.1;
      const elbow = -(0.5 + Math.sin(z.phase) * 0.08) + lunge * 0.4;
      let p = this._part(
        this.upArmL,
        i,
        this._root,
        -0.37 * bulk,
        1.31 + bob,
        0.02,
        armRaise + armSway,
        0.1,
        limb,
      );
      this._m1.copy(p);
      this._part(this.foreL, i, this._m1, 0, -0.34, 0, elbow, 0.05, limb);
      p = this._part(
        this.upArmR,
        i,
        this._root,
        0.37 * bulk,
        1.31 + bob,
        0.02,
        armRaise - armSway,
        -0.1,
        limb,
      );
      this._m1.copy(p);
      this._part(this.foreR, i, this._m1, 0, -0.34, 0, elbow, -0.05, limb);

      // legs: thigh swing with knee flexion on the swing-through
      const kneeL = -(0.15 + Math.max(0, Math.sin(z.phase + 0.6)) * 0.5) * gait;
      const kneeR =
        -(0.15 + Math.max(0, Math.sin(z.phase + Math.PI + 0.6)) * 0.5) * gait;
      p = this._part(
        this.thighL,
        i,
        this._root,
        -0.14 * bulk,
        0.94,
        0,
        swing,
        0,
        limb,
      );
      this._m1.copy(p);
      this._part(this.shinL, i, this._m1, 0, -0.46, 0, kneeL, 0, limb);
      p = this._part(
        this.thighR,
        i,
        this._root,
        0.14 * bulk,
        0.94,
        0,
        -swing,
        0,
        limb,
      );
      this._m1.copy(p);
      this._part(this.shinR, i, this._m1, 0, -0.46, 0, kneeR, 0, limb);

      d.position.set(z.x, z.y + 0.02, z.z);
      d.rotation.set(0, 0, 0, "YXZ");
      d.scale.setScalar(z.scale * (0.85 + bulk * 0.15) * (1 - sink));
      d.updateMatrix();
      this.blob.setMatrixAt(i, d.matrix);
    }
    for (const m of this.parts) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.blob.instanceMatrix.needsUpdate = true;
  }
}

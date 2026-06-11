// instanced low-poly zombie rig: 6 body-part InstancedMeshes + a blob
// shadow, so a full horde costs ~7 draw calls. castShadow stays off to keep
// shadowMap.autoUpdate=false intact - the blob fakes grounding (real
// shadow-casting is a deferred option).
import * as THREE from "three";

const LUNGE_T = 0.35; // matches Zombie.js lunge timer

export class ZombieMesh {
  constructor(capacity) {
    this.capacity = capacity;
    this.group = new THREE.Group();
    // material stays white: setColorAt multiplies material color (M1 gotcha)
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const cloth = new THREE.MeshStandardMaterial({ roughness: 1 });
    const box = (w, h, d, py = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (py) g.translate(0, py, 0);
      return g;
    };
    const part = (geo, mat) => {
      const m = new THREE.InstancedMesh(geo, mat, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.torso = part(box(0.55, 0.62, 0.3), cloth);
    this.head = part(box(0.3, 0.32, 0.3), skin);
    // arm/leg pivots sit at the joint so a single rotation swings them
    this.armL = part(box(0.15, 0.62, 0.15, -0.27), skin);
    this.armR = part(box(0.15, 0.62, 0.15, -0.27), skin);
    this.legL = part(box(0.18, 0.92, 0.18, -0.46), cloth);
    this.legR = part(box(0.18, 0.92, 0.18, -0.46), cloth);
    this.parts = [
      this.torso,
      this.head,
      this.armL,
      this.armR,
      this.legL,
      this.legR,
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

  // greenish-gray skin + muted clothes, slight per-zombie variation
  setColor(i, rng) {
    const g = 0.5 + rng() * 0.18;
    this._c.setRGB(g * 0.72, g, g * 0.68);
    this.head.setColorAt(i, this._c);
    this.armL.setColorAt(i, this._c);
    this.armR.setColorAt(i, this._c);
    const t = 0.2 + rng() * 0.16;
    this._c.setRGB(t * (0.8 + rng() * 0.4), t * 0.9, t);
    this.torso.setColorAt(i, this._c);
    this.legL.setColorAt(i, this._c);
    this.legR.setColorAt(i, this._c);
    for (const m of this.parts) m.instanceColor.needsUpdate = true;
  }

  _local(px, py, pz, rx, rz = 0) {
    const d = this._d;
    d.position.set(px, py, pz);
    d.rotation.set(rx, 0, rz);
    d.scale.setScalar(1);
    d.updateMatrix();
    return this._tmp.multiplyMatrices(this._root, d.matrix);
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
      d.position.set(z.x, z.y, z.z);
      d.rotation.set(0, z.yaw, 0);
      d.scale.setScalar(z.scale);
      d.updateMatrix();
      this._root.copy(d.matrix);

      const lunge = z.lunge / LUNGE_T;
      const swing = Math.sin(z.phase) * 0.5;
      const bob = Math.sin(z.phase * 2) * 0.025;
      this.torso.setMatrixAt(
        i,
        this._local(0, 1.07 + bob, 0, 0.12 + lunge * 0.15),
      );
      this.head.setMatrixAt(
        i,
        this._local(0, 1.5 + bob, -0.03, 0.1, Math.sin(z.phase) * 0.07),
      );
      const armX = 1.32 + lunge * 0.5;
      this.armL.setMatrixAt(
        i,
        this._local(-0.34, 1.3 + bob, 0, armX + Math.sin(z.phase) * 0.14, 0.08),
      );
      this.armR.setMatrixAt(
        i,
        this._local(0.34, 1.3 + bob, 0, armX - Math.sin(z.phase) * 0.14, -0.08),
      );
      this.legL.setMatrixAt(i, this._local(-0.12, 0.92, 0, swing));
      this.legR.setMatrixAt(i, this._local(0.12, 0.92, 0, -swing));

      d.position.set(z.x, z.y + 0.02, z.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(z.scale);
      d.updateMatrix();
      this.blob.setMatrixAt(i, d.matrix);
    }
    for (const m of this.parts) m.instanceMatrix.needsUpdate = true;
    this.blob.instanceMatrix.needsUpdate = true;
  }
}

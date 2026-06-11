// pooled shot particles: additive Points (sparks/flash glow), alpha Points
// (smoke/blood/dust), and instanced brass casings with terrain bounce.
// +3 draw calls total; everything lives on layer 2 (AO override passes
// would stamp square smudges through point sprites). Purely cosmetic -
// deliberately outside seed determinism (Math.random).
import * as THREE from "three";

const ADD_CAP = 160;
const ALPHA_CAP = 224;
const CASE_CAP = 24;
const LAYER = 2;

// pure: march a ray against the heightfield, linear-refined hit -> point|null
export function rayGround(heightAt, ox, oy, oz, dx, dy, dz, range, step = 1.5) {
  let prevT = 0;
  let prevD = oy - heightAt(ox, oz);
  if (prevD <= 0) return { x: ox, y: oy, z: oz };
  for (let t = step; t <= range; t += step) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const d = y - heightAt(x, z);
    if (d <= 0) {
      const f = prevD / (prevD - d);
      const tt = prevT + (t - prevT) * f;
      return { x: ox + dx * tt, y: oy + dy * tt, z: oz + dz * tt };
    }
    prevT = t;
    prevD = d;
  }
  return null;
}

// pure casing integrator: gravity, terrain bounce with damping, settle
export function stepCasing(c, dt, heightAt) {
  c.vy -= 12 * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.z += c.vz * dt;
  c.rx += c.avx * dt;
  c.ry += c.avy * dt;
  c.rz += c.avz * dt;
  const g = heightAt(c.x, c.z) + 0.015;
  if (c.y <= g) {
    c.y = g;
    c.vy = c.vy < -0.5 ? -c.vy * 0.35 : 0;
    c.vx *= 0.55;
    c.vz *= 0.55;
    c.avx *= 0.4;
    c.avy *= 0.4;
    c.avz *= 0.4;
  }
  c.life -= dt;
  return c;
}

class PointPool {
  constructor(cap, blending) {
    this.cap = cap;
    this.alive = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.aCol = new THREE.BufferAttribute(
      new Float32Array(cap * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.aFade = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("aColor", this.aCol);
    geo.setAttribute("aSize", this.aSize);
    geo.setAttribute("aFade", this.aFade);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      blending,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aFade;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vColor = aColor;
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          // aSize is a WORLD diameter in meters; clamp keeps near-muzzle
          // sprites from filling the screen
          gl_PointSize = min( aSize * ( 330.0 / max( 0.6, -mv.z ) ), 200.0 );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          float d = length( gl_PointCoord - 0.5 );
          float a = smoothstep( 0.5, 0.12, d ) * vFade;
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( vColor, a );
        }`,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER);
    this.mesh.renderOrder = 7;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0) {
    if (this.alive >= this.cap) return; // pool full: drop, never grow
    const i = this.alive++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.aCol.array.set([r, g, b], i * 3);
    this.aSize.array[i] = size;
    this.life[i] = this.max[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-with-last keeps the live range dense
        const last = --this.alive;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.aCol.array.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.aSize.array[i] = this.aSize.array[last];
          this.life[i] = this.life[last];
          this.max[i] = this.max[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
        }
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.aFade.array[i] = this.life[i] / this.max[i];
      i++;
    }
    this.mesh.geometry.setDrawRange(0, this.alive);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aFade.needsUpdate = true;
  }
}

const J = (s) => (Math.random() * 2 - 1) * s; // jitter

export class Particles {
  constructor(scene, heightAt) {
    this.heightAt = heightAt;
    this.add = new PointPool(ADD_CAP, THREE.AdditiveBlending);
    this.alpha = new PointPool(ALPHA_CAP, THREE.NormalBlending);
    scene.add(this.add.mesh, this.alpha.mesh);

    this.caseMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.025, 0.025, 0.055),
      new THREE.MeshStandardMaterial({
        color: 0xc9a04a,
        roughness: 0.35,
        metalness: 0.85,
      }),
      CASE_CAP,
    );
    this.caseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caseMesh.frustumCulled = false;
    this.caseMesh.castShadow = false;
    scene.add(this.caseMesh);
    this._d = new THREE.Object3D();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.cases = [];
    for (let i = 0; i < CASE_CAP; i++) {
      this.cases.push({ life: 0 });
      this.caseMesh.setMatrixAt(i, this._zero);
    }
  }

  muzzle(p, d) {
    // flash glow + spark fan + a curl of smoke (sizes are world meters)
    this.add.emit(p.x, p.y, p.z, 0, 0, 0, 1.5, 1.15, 0.55, 0.34, 0.07);
    for (let i = 0; i < 8; i++) {
      const s = 7 + Math.random() * 9;
      this.add.emit(
        p.x,
        p.y,
        p.z,
        d.x * s + J(2.5),
        d.y * s + J(2.5) + 0.5,
        d.z * s + J(2.5),
        1.5,
        1.0 + Math.random() * 0.3,
        0.4,
        0.04 + Math.random() * 0.05,
        0.1 + Math.random() * 0.16,
        9,
        2,
      );
    }
    for (let i = 0; i < 2; i++) {
      const g = 0.47 + Math.random() * 0.06;
      this.alpha.emit(
        p.x + J(0.05),
        p.y + J(0.05),
        p.z + J(0.05),
        d.x * 1.4 + J(0.4),
        d.y * 1.4 + 0.5,
        d.z * 1.4 + J(0.4),
        g,
        g,
        g * 0.96,
        0.22 + Math.random() * 0.2,
        0.45 + Math.random() * 0.35,
        -0.6, // smoke rises
        2.4,
      );
    }
  }

  blood(p, d) {
    for (let i = 0; i < 9; i++) {
      const s = 1.2 + Math.random() * 2.8;
      const r = 0.3 + Math.random() * 0.1;
      this.alpha.emit(
        p.x,
        p.y + J(0.1),
        p.z,
        d.x * s + J(1.2),
        d.y * s + J(1.2) + 0.6,
        d.z * s + J(1.2),
        r,
        0.04,
        0.035,
        0.1 + Math.random() * 0.14,
        0.28 + Math.random() * 0.3,
        6.5,
        0.8,
      );
    }
  }

  dust(p) {
    for (let i = 0; i < 6; i++) {
      const t = 0.42 + Math.random() * 0.08;
      this.alpha.emit(
        p.x + J(0.15),
        p.y + 0.05,
        p.z + J(0.15),
        J(1.1),
        0.8 + Math.random() * 1.2,
        J(1.1),
        t,
        t * 0.92,
        t * 0.76,
        0.3 + Math.random() * 0.35,
        0.5 + Math.random() * 0.4,
        1.2,
        1.4,
      );
    }
  }

  casing(p, right) {
    const c = this.cases.find((c) => c.life <= 0);
    if (!c) return;
    Object.assign(c, {
      x: p.x,
      y: p.y - 0.04,
      z: p.z,
      vx: right.x * (1.8 + Math.random() * 0.8) + J(0.5),
      vy: 2.2 + Math.random() * 0.8,
      vz: right.z * (1.8 + Math.random() * 0.8) + J(0.5),
      rx: Math.random() * Math.PI,
      ry: Math.random() * Math.PI,
      rz: 0,
      avx: J(14),
      avy: J(14),
      avz: J(14),
      life: 5,
    });
  }

  groundHit(ox, oy, oz, dx, dy, dz, range) {
    return rayGround(this.heightAt, ox, oy, oz, dx, dy, dz, range);
  }

  update(dt) {
    this.add.update(dt);
    this.alpha.update(dt);
    const d = this._d;
    for (let i = 0; i < this.cases.length; i++) {
      const c = this.cases[i];
      if (c.life <= 0) continue;
      stepCasing(c, dt, this.heightAt);
      if (c.life <= 0) {
        this.caseMesh.setMatrixAt(i, this._zero);
        continue;
      }
      d.position.set(c.x, c.y, c.z);
      d.rotation.set(c.rx, c.ry, c.rz);
      // brass blinks out via a shrink over the last half second
      d.scale.setScalar(Math.min(1, c.life * 2));
      d.updateMatrix();
      this.caseMesh.setMatrixAt(i, d.matrix);
    }
    this.caseMesh.instanceMatrix.needsUpdate = true;
  }
}

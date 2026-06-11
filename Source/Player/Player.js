import * as THREE from "three";
import { BOUND } from "../Core/Heightfield.js";
import { resolvePlayer, standHeight } from "../Engine/Collision.js";

const EYE = 1.7;
const RADIUS = 0.45;
const WALK = 5.2;
const SPRINT = 8.8;
const ACCEL = 11;
const AIR_ACCEL = 2.5;
const GRAVITY = 22;
const JUMP = 7.6;
const LOOK_SPEED = 0.0022;

export class Player {
  constructor(camera, input, hf, boxes, trunks, spawn, events = {}) {
    this.camera = camera;
    this.input = input;
    this.hf = hf;
    this.boxes = boxes;
    this.trunks = trunks;

    this.pos = new THREE.Vector3(
      spawn.x,
      hf.heightAt(spawn.x, spawn.z),
      spawn.z,
    );
    this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.grounded = true;
    this.events = events;
    this.stride = 0;
    this.bobPhase = 0;
    this.landDip = 0;
    this.update(0);
  }

  update(dt) {
    const [lx, ly] = this.input.consumeLook();
    this.yaw -= lx * LOOK_SPEED;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - ly * LOOK_SPEED,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );

    const fwd =
      (this.input.down("KeyW") ? 1 : 0) - (this.input.down("KeyS") ? 1 : 0);
    const side =
      (this.input.down("KeyD") ? 1 : 0) - (this.input.down("KeyA") ? 1 : 0);
    const sprint =
      this.input.down("ShiftLeft") || this.input.down("ShiftRight");
    const speed = sprint ? SPRINT : WALK;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * side;
    let wz = -cos * fwd - sin * side;
    const len = Math.hypot(wx, wz) || 1;
    wx = (wx / len) * speed;
    wz = (wz / len) * speed;

    const k = 1 - Math.exp(-(this.grounded ? ACCEL : AIR_ACCEL) * dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (this.grounded && this.input.down("Space")) {
      this.vel.y = JUMP;
      this.grounded = false;
    }
    if (!this.grounded) this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -BOUND, BOUND);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -BOUND, BOUND);

    const r = resolvePlayer(
      this.pos.x,
      this.pos.z,
      RADIUS,
      this.pos.y,
      this.pos.y + EYE,
      this.boxes,
      this.trunks,
    );
    this.pos.x = r.x;
    this.pos.z = r.z;

    const ground = Math.max(
      this.hf.heightAt(this.pos.x, this.pos.z),
      standHeight(
        this.pos.x,
        this.pos.z,
        RADIUS,
        this.pos.y,
        this.boxes,
        this.trunks,
      ),
    );
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vel.y < -5) {
        this.landDip = Math.min(0.16, -this.vel.y * 0.014);
        if (this.events.onLand) this.events.onLand(-this.vel.y);
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.02) {
      // walked off an edge: short coyote snap keeps downhill walking smooth
      if (this.grounded && this.vel.y <= 0 && this.pos.y < ground + 0.5) {
        this.pos.y = ground;
      } else {
        this.grounded = false;
      }
    }

    // movement feel: stride steps, subtle head-bob, landing dip
    const speedH = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speedH > 1) {
      this.stride += speedH * dt;
      if (this.stride > (speedH > 6.5 ? 2.6 : 2.1)) {
        this.stride = 0;
        if (this.events.onStep) this.events.onStep(speedH > 6.5);
      }
      this.bobPhase += dt * (5 + speedH * 0.6);
    }
    const bob =
      Math.sin(this.bobPhase * 2) * 0.024 * Math.min(speedH / 5.2, 1.5);
    this.landDip *= Math.exp(-7 * dt);

    this.camera.position.set(
      this.pos.x,
      this.pos.y + EYE + bob - this.landDip,
      this.pos.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }
}

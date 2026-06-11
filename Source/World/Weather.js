import * as THREE from "three";
import { Mulberry } from "../Core/Rng.js";

const COUNT = 2600;
const BOX = 18; // spawn half-extent around the player
const H = 16; // fall column height
const RAIN_LAYER = 2; // custom vertex shader -> excluded from GTAO pre-passes

// drizzle cycle + camera-following rain streaks; while raining the fog
// closes in, the sun dims and grass gusts pick up (shared-wind model)
export class Weather {
  constructor(scene, sun, fog, renderer, seed = 7) {
    this.sun = sun;
    this.fog = fog;
    this.renderer = renderer;
    this.baseExposure = renderer.toneMappingExposure;
    this.baseSun = sun.intensity;
    this.baseNear = fog.near;
    this.baseFar = fog.far;
    this.baseCol = fog.color.clone();
    this.wetCol = new THREE.Color(0x99a3ac);
    this.intensity = 0;
    this.gust = 1;
    this.t = 0;

    const rng = Mulberry(seed + 77);
    const pos = new Float32Array(COUNT * 6);
    const seeds = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const x = (rng() * 2 - 1) * BOX;
      const y = rng() * H;
      const z = (rng() * 2 - 1) * BOX;
      pos.set([x, y, z, x, y, z], i * 6);
      const s = rng();
      seeds.set([s, 1, s, 0], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 2));
    this.uniforms = { uTime: { value: 0 }, uMix: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uMix;
        attribute vec2 aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod( p.y - uTime * ( 11.0 + aSeed.x * 5.0 ), ${H.toFixed(1)} );
          vec2 tilt = vec2( 0.16, 0.12 );
          p.xz += tilt * p.y * 0.06;
          if ( aSeed.y > 0.5 ) { p.y += 0.4; p.xz += tilt * 0.03; }
          vA = step( aSeed.x, uMix );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform float uMix;
        varying float vA;
        void main() {
          gl_FragColor = vec4( 0.6, 0.68, 0.78, 0.3 ) * vA * min( uMix * 2.0, 1.0 );
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(RAIN_LAYER);
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);

    const q = new URLSearchParams(location.search);
    this.force = q.has("rain") ? 1 : q.has("norain") ? 0 : null;
  }

  update(dt, p) {
    this.t += dt;
    // layered slow sines: long clear stretches, occasional drizzle
    const c =
      Math.sin(this.t * 0.011) * 0.6 + Math.sin(this.t * 0.0043 + 2.1) * 0.4;
    const k = Math.min(1, Math.max(0, (c - 0.45) / 0.3));
    const target = this.force ?? k * k * (3 - 2 * k);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.15);
    const w = this.intensity;
    this.mesh.visible = w > 0.02;
    if (this.mesh.visible) {
      this.mesh.position.set(p.x, p.y - 2, p.z);
      this.uniforms.uTime.value = this.t;
      this.uniforms.uMix.value = w;
    }
    this.gust = 1 + w * 1.4;
    this.sun.intensity = this.baseSun * (1 - 0.5 * w);
    // overcast: turbid gray dome + global exposure drop
    if (this.setOvercast) this.setOvercast(w);
    this.renderer.toneMappingExposure = this.baseExposure * (1 - 0.42 * w);
    this.fog.near = this.baseNear * (1 - 0.4 * w);
    this.fog.far = this.baseFar * (1 - 0.42 * w);
    this.fog.color.copy(this.baseCol).lerp(this.wetCol, w * 0.8);
  }
}

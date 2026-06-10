import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

const SUN_ELEVATION = 16; // low sun -> long shadows
const SUN_AZIMUTH = 205;
const SHADOW_SPAN = 55;
const SHADOW_RES = 2048;

export function createSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(2000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;

  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  scene.fog = new THREE.Fog(0xd8cfbe, 80, 380);

  const sun = new THREE.DirectionalLight(0xffe2bd, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -SHADOW_SPAN;
  cam.right = cam.top = SHADOW_SPAN;
  cam.near = 10;
  cam.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // cool fill so shadows read blue against the warm sun
  scene.add(new THREE.HemisphereLight(0xbcd2ee, 0x8a7a58, 0.85));
  scene.add(new THREE.AmbientLight(0x4e5c78, 0.7));

  const texel = (SHADOW_SPAN * 2) / SHADOW_RES;
  const update = (target) => {
    // snap the shadow frustum to texels so edges don't shimmer while walking
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx + sunDir.x * 150, sunDir.y * 150, tz + sunDir.z * 150);
  };
  update(new THREE.Vector3());

  return { sun, sunDir, update };
}

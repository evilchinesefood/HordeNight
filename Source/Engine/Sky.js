import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { cloudTexture } from "./Textures.js";
import { Mulberry } from "../Core/Rng.js";

const SUN_ELEVATION = 14; // low sun -> long shadows
const SUN_AZIMUTH = 205;
const SHADOW_SPAN = 48;
const SHADOW_RES = 1536;
const CLOUD_COUNT = 13;
export const CLOUD_LAYER = 1; // excluded from the GTAO pre-passes

// --- global fog upgrade: height falloff + golden in-scatter toward the sun ---
// patched once at module load, before any material compiles; the extra
// uniforms ride along UniformsLib.fog (static values, cloned per material)
const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

Object.assign(THREE.UniformsLib.fog, {
  uFogSunDir: { value: SUN_DIR.clone() },
  uFogSunColor: { value: new THREE.Color(0xffdcae) },
  uFogBaseY: { value: 2.0 },
  uFogHeightDecay: { value: 0.06 },
});

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWp = instanceMatrix * fogWp;
  #endif
  vFogWorldPos = ( modelMatrix * fogWp ).xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunColor;
  uniform float uFogBaseY;
  uniform float uFogHeightDecay;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  float fogH = exp( -max( vFogWorldPos.y - uFogBaseY, 0.0 ) * uFogHeightDecay );
  fogFactor *= mix( 0.45, 1.0, fogH );
  vec3 fogViewDir = normalize( vFogWorldPos - cameraPosition );
  float fogSun = pow( max( dot( fogViewDir, uFogSunDir ), 0.0 ), 6.0 );
  vec3 fogCol = mix( fogColor, uFogSunColor, fogSun * 0.7 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

function createClouds(scene) {
  const rng = Mulberry(99);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: cloudTexture(),
    color: new THREE.Color(1.5, 1.42, 1.3), // warm-lit, reads through ACES
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: false,
  });
  mat.customProgramCacheKey = () => "hn-cloud";
  mat.onBeforeCompile = (s) => {
    // view-aligned billboard, scale from the instance matrix
    s.vertexShader = s.vertexShader.replace(
      "#include <project_vertex>",
      `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
      mvPosition.xy += position.xy *
        vec2( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ) );
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };

  const clouds = new THREE.InstancedMesh(geo, mat, CLOUD_COUNT);
  clouds.layers.set(CLOUD_LAYER);
  clouds.frustumCulled = false;
  clouds.renderOrder = 5;
  const items = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    items.push({
      x: (rng() * 2 - 1) * 750,
      y: 140 + rng() * 110,
      z: (rng() * 2 - 1) * 750,
      w: 140 + rng() * 160,
      h: 45 + rng() * 40,
      speed: 2 + rng() * 2.5,
    });
  }
  const m = new THREE.Matrix4();
  const update = (t) => {
    items.forEach((c, i) => {
      const x = ((((c.x + t * c.speed + 750) % 1500) + 1500) % 1500) - 750;
      m.makeScale(c.w, c.h, 1);
      m.setPosition(x, c.y, c.z);
      clouds.setMatrixAt(i, m);
    });
    clouds.instanceMatrix.needsUpdate = true;
  };
  update(0);
  scene.add(clouds);
  return update;
}

export function createSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(2000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7;
  u.rayleigh.value = 1.8;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  scene.add(sky);

  // cool base haze; the fog patch warms it toward the sun
  scene.fog = new THREE.Fog(0xc7cdd6, 70, 360);

  const sun = new THREE.DirectionalLight(0xffd9a6, 3.0);
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
  scene.add(new THREE.HemisphereLight(0xbcd2ee, 0x8a7a58, 1.05));
  scene.add(new THREE.AmbientLight(0x4e5c78, 0.8));

  const updateClouds = createClouds(scene);

  const texel = (SHADOW_SPAN * 2) / SHADOW_RES;
  const update = (target, t = 0) => {
    // snap the shadow frustum to texels so edges don't shimmer while walking
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(
      tx + SUN_DIR.x * 150,
      SUN_DIR.y * 150,
      tz + SUN_DIR.z * 150,
    );
    updateClouds(t);
  };
  update(new THREE.Vector3());

  return { sun, sunDir: SUN_DIR, update };
}

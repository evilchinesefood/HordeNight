import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { cloudTexture, cirrusTexture } from "./Textures.js";
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
  vec3 fogCol = mix( fogColor, uFogSunColor, fogSun * 0.6 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

function createClouds(scene) {
  const rng = Mulberry(99);
  const geo = new THREE.PlaneGeometry(1, 1);
  const billboard = (mat) => {
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
    return mat;
  };
  const layers = [];
  const makeLayer = (map, color, opacity, order, count, gen) => {
    const mat = billboard(
      new THREE.MeshBasicMaterial({
        map,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: false,
      }),
    );
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.layers.set(CLOUD_LAYER);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    const items = [];
    for (let i = 0; i < count; i++) items.push(gen());
    scene.add(mesh);
    layers.push({ mesh, items });
  };
  // high thin cirrus drifts behind the cumulus deck
  makeLayer(
    cirrusTexture(),
    new THREE.Color(1.35, 1.35, 1.42),
    0.34,
    4,
    9,
    () => ({
      x: (rng() * 2 - 1) * 700,
      y: 250 + rng() * 90,
      z: (rng() * 2 - 1) * 700,
      w: 300 + rng() * 240,
      h: 30 + rng() * 26,
      speed: 0.7 + rng() * 0.9,
    }),
  );
  makeLayer(
    cloudTexture(),
    new THREE.Color(1.5, 1.42, 1.3), // warm-lit, reads through ACES
    0.6,
    5,
    CLOUD_COUNT,
    () => ({
      x: (rng() * 2 - 1) * 600,
      y: 140 + rng() * 110,
      z: (rng() * 2 - 1) * 600,
      w: 140 + rng() * 160,
      h: 45 + rng() * 40,
      speed: 2 + rng() * 2.5,
    }),
  );
  const m = new THREE.Matrix4();
  const update = (t) => {
    for (const { mesh, items } of layers) {
      items.forEach((c, i) => {
        const x = ((((c.x + t * c.speed + 600) % 1200) + 1200) % 1200) - 600;
        m.makeScale(c.w, c.h, 1);
        m.setPosition(x, c.y, c.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
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
  // AO-excluded foliage (layer 2) must still cast canopy shadows
  cam.layers.enable(2);
  scene.add(sun, sun.target);

  // cool fill so shadows read blue against the warm sun
  scene.add(new THREE.HemisphereLight(0xbcd2ee, 0x8a7a58, 1.05));
  scene.add(new THREE.AmbientLight(0x4e5c78, 0.8));

  const updateClouds = createClouds(scene);

  const texel = (SHADOW_SPAN * 2) / SHADOW_RES;
  let lastTx = null;
  let lastTz = null;
  const update = (target, t = 0) => {
    // snap the shadow frustum to texels so edges don't shimmer while walking
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    const moved = tx !== lastTx || tz !== lastTz;
    if (moved) {
      lastTx = tx;
      lastTz = tz;
      sun.target.position.set(tx, 0, tz);
      sun.position.set(
        tx + SUN_DIR.x * 150,
        SUN_DIR.y * 150,
        tz + SUN_DIR.z * 150,
      );
    }
    updateClouds(t);
    return moved; // caller gates renderer.shadowMap.needsUpdate on this
  };
  update(new THREE.Vector3());

  return { sun, sunDir: SUN_DIR, update };
}

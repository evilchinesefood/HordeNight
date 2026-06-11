import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { cloudTexture, cirrusTexture } from "./Textures.js";
import { Mulberry } from "../Core/Rng.js";

const SUN_ELEVATION = 55; // late-morning sun
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
  // horizon-projected: fogged geometry sits at/below the horizon, so the
  // elevation-true dir would zero the pow() lobe (cos(55deg)^24 ~ 1.6e-6)
  uFogSunDir: { value: new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize() },
  uFogSunColor: { value: new THREE.Color(0xfff3e0) },
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
  float fogSun = pow( max( dot( fogViewDir, uFogSunDir ), 0.0 ), 24.0 );
  vec3 fogCol = mix( fogColor, uFogSunColor, fogSun * 0.45 );
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
    mat.userData.base = mat.color.clone(); // night preset dims from this
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      // +-600 like the cumulus deck: +-700 spawned z beyond the 900 far plane
      x: (rng() * 2 - 1) * 600,
      y: 250 + rng() * 90,
      z: (rng() * 2 - 1) * 600,
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
  const setTone = (mult) => {
    for (const { mesh } of layers)
      mesh.material.color
        .copy(mesh.material.userData.base)
        .multiplyScalar(mult);
  };
  let lastT = -1;
  const update = (t) => {
    if (lastT >= 0 && t - lastT < 0.1) return; // drift is sub-pixel per frame
    lastT = t;
    for (const { mesh, items } of layers) {
      for (let i = 0; i < items.length; i++) {
        const c = items[i];
        const x = ((((c.x + t * c.speed + 600) % 1200) + 1200) % 1200) - 600;
        m.makeScale(c.w, c.h, 1);
        m.setPosition(x, c.y, c.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  return { update, setTone };
}

export function createSky(scene) {
  const sky = new Sky();
  sky.scale.setScalar(2000);
  const u = sky.material.uniforms;
  // single source of truth: weather's setOvercast(0) must return EXACTLY here
  const CLEAR = { turbidity: 3, rayleigh: 0.5, mie: 0.001 };
  u.turbidity.value = CLEAR.turbidity;
  u.rayleigh.value = CLEAR.rayleigh;
  u.mieCoefficient.value = CLEAR.mie;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  // the raw near-sun glare sits at 3-10x white over +-20deg and the solar
  // disk at ~19000x: ACES clips that whole region to a frame-wide blob.
  // Two-knee luminance curve: blue sky (<0.85) untouched, glare compressed
  // to a soft gradient, only the disk stays bright enough to clip white
  const KNEE_NEEDLE = "gl_FragColor = vec4( retColor, 1.0 );";
  const DISK_NEEDLE =
    "const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;";
  const skyFrag = sky.material.fragmentShader;
  if (!skyFrag.includes(KNEE_NEEDLE) || !skyFrag.includes(DISK_NEEDLE))
    console.warn(
      "Sky shader patch needles missing - a three upgrade changed Sky.js; the supernova sun is back",
    );
  sky.material.fragmentShader = skyFrag
    .replace("void main() {", "uniform float uDim;\nvoid main() {")
    .replace(
      KNEE_NEEDLE,
      `float skyL = dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) );
      float skyK = skyL < 0.85 ? skyL
        : skyL < 12.0 ? 0.85 + ( skyL - 0.85 ) * 0.18
        : 2.857 + ( skyL - 12.0 ) * 0.0004;
      gl_FragColor = vec4( retColor * ( skyK / max( skyL, 1e-4 ) ) * uDim, 1.0 );`,
    )
    // 0.9999833 = day disk 25% wider than the 0.9999893 tuning
    .replace(DISK_NEEDLE, "const float sunAngularDiameterCos = 0.9999833;");
  u.uDim = { value: 1 }; // storm dome dimmer (setOvercast)
  scene.add(sky);

  // cool base haze; the fog patch warms it toward the sun
  scene.fog = new THREE.Fog(0xc7cdd6, 70, 360);

  const sun = new THREE.DirectionalLight(0xfff1d8, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -SHADOW_SPAN;
  cam.right = cam.top = SHADOW_SPAN;
  cam.near = 10;
  cam.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.15; // roof slopes striped with acne at 0.03
  // NOTE: shadow visibility is tested against the MAIN camera's layer mask
  // (not this shadow camera), so layer-2 foliage casts shadows only because
  // Main.js enables layer 2 on the player camera - that enable is load-bearing
  scene.add(sun, sun.target);

  // cool fill so shadows read blue against the warm sun
  const hemi = new THREE.HemisphereLight(0xbcd2ee, 0x8a7a58, 1.05);
  const amb = new THREE.AmbientLight(0x4e5c78, 0.8);
  scene.add(hemi, amb);

  // dev/night preset: sun dips below the horizon, moonlight takes over
  const NIGHT_DIR = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(98),
    theta,
  );
  // overcast blend for weather: rayleigh dies (no blue), turbid milky-gray
  // dome, clouds dim toward storm gray
  let nightOn = false;
  const cloudTone = (w) => (nightOn ? 0.12 : 1) * (1 - w * 0.62);
  // NOTE: weather calls this every frame - w=0 MUST equal the clear-sky
  // uniforms above or it silently overrides any tuning
  const setOvercast = (w) => {
    u.turbidity.value = CLEAR.turbidity + w * 22;
    u.mieCoefficient.value = CLEAR.mie + w * 0.007;
    u.rayleigh.value = CLEAR.rayleigh - w * 0.46; // blue dies fully in a storm
    u.uDim.value = 1 - w * 0.55; // and the dome itself darkens
    clouds.setTone(cloudTone(w));
  };
  const setNight = (on) => {
    nightOn = on;
    u.sunPosition.value.copy(on ? NIGHT_DIR : SUN_DIR);
    sun.intensity = on ? 0.4 : 3.0;
    sun.color.set(on ? 0x91a8d0 : 0xfff1d8);
    hemi.intensity = on ? 0.2 : 1.05;
    amb.intensity = on ? 0.28 : 0.8;
    clouds.setTone(cloudTone(0)); // unlit billboards: dim them by hand
    return sun.intensity; // new weather baseline
  };

  const clouds = createClouds(scene);

  // snap in 16-texel (1m) steps: still texel-aligned (no edge shimmer), but
  // coarse enough that walking doesn't re-render the caster pass every frame
  const SNAP = ((SHADOW_SPAN * 2) / SHADOW_RES) * 16;
  let lastTx = null;
  let lastTz = null;
  const update = (target, t = 0) => {
    const tx = Math.round(target.x / SNAP) * SNAP;
    const tz = Math.round(target.z / SNAP) * SNAP;
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
    clouds.update(t);
    return moved; // caller gates renderer.shadowMap.needsUpdate on this
  };
  update(new THREE.Vector3());

  return { sun, sunDir: SUN_DIR, update, setNight, setOvercast };
}

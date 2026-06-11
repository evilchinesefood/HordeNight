import * as THREE from "three";
import { WORLD_SIZE, WATER_Y } from "../Core/Heightfield.js";
import { Fbm2 } from "../Core/Noise.js";
import { groundTextureSet, causticTexture } from "../Engine/Textures.js";

const RES = 384;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const SPLAT_GLSL = `
  vec2 gUv = vNormalMapUv * 100.0;
  vec2 dUv = vNormalMapUv * 88.0;
  vec2 rUv = vNormalMapUv * 56.0;
  float bn = texture2D( tBreak, vNormalMapUv * 13.0 ).r - 0.5;
  vec3 sw = clamp( vSplat + bn * 0.55, 0.0, 1.0 );
  sw = sw * sw * sw;
  sw /= sw.x + sw.y + sw.z;
  vec3 alb = texture2D( tGrass, gUv ).rgb * sw.x
           + texture2D( tDirt, dUv ).rgb * sw.y
           + texture2D( tRock, rUv ).rgb * sw.z;
  vec3 alb2 = texture2D( tGrass, gUv * 0.23 ).rgb * sw.x
            + texture2D( tDirt, dUv * 0.23 ).rgb * sw.y
            + texture2D( tRock, rUv * 0.23 ).rgb * sw.z;
  alb = mix( alb, alb2, 0.35 );
  diffuseColor.rgb *= alb * vColor;

  // dancing caustics on the streambed (two scrolling reads, min() sharpens)
  float cWet = smoothstep( 0.05, -0.35, vWy );
  if ( cWet > 0.0 ) {
    float ca = texture2D( tCaustic, vNormalMapUv * 110.0 + uTime * vec2( 0.05, 0.07 ) ).r;
    float cb = texture2D( tCaustic, vNormalMapUv * 86.0 - uTime * vec2( 0.06, 0.035 ) ).r;
    float cDim = smoothstep( -2.4, -0.5, vWy );
    diffuseColor.rgb += diffuseColor.rgb * min( ca, cb ) * cWet * ( 0.5 + 1.3 * cDim ) * 2.0;
  }
`;

const NORMAL_GLSL = `
  vec3 mapN = ( texture2D( tGrassN, gUv ).xyz * sw.x
              + texture2D( tDirtN, dUv ).xyz * sw.y
              + texture2D( tRockN, rUv ).xyz * sw.z ) * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
`;

export function createTerrain(hf, anisotropy = 4) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RES, RES);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const tint = Fbm2(hf.seed + 55);
  const patches = Fbm2(hf.seed + 56);

  // worn paths: connect each site to its nearest neighbor unless the
  // segment would cross the stream
  const paths = [];
  const seen = new Set();
  for (let i = 0; i < hf.sites.length; i++) {
    let bj = -1;
    let bd = 1e9;
    for (let j = 0; j < hf.sites.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(
        hf.sites[i].x - hf.sites[j].x,
        hf.sites[i].z - hf.sites[j].z,
      );
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    if (bj < 0 || bd > 110) continue;
    const key = Math.min(i, bj) + ":" + Math.max(i, bj);
    if (seen.has(key)) continue;
    seen.add(key);
    const a = hf.sites[i];
    const b = hf.sites[bj];
    let crosses = false;
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      if (hf.streamDist(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < 12)
        crosses = true;
    }
    if (!crosses) paths.push([a.x, a.z, b.x, b.z]);
  }
  const pathDist = (x, z) => {
    let best = 1e9;
    for (const [ax, az, bx, bz] of paths) {
      const dx = bx - ax;
      const dz = bz - az;
      const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  };
  const normal = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 3); // grass, dirt, rock
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = normal.getY(i);

    let rock = clamp01((0.8 - ny) / 0.16) + clamp01((y - 11) / 7) * 0.5;
    let dirt =
      clamp01((WATER_Y + 0.8 - y) / 1.0) +
      Math.max(0, patches(x * 0.02, z * 0.02, 3) - 0.42) * 1.4;
    if (y < WATER_Y) dirt += 2;
    for (const s of hf.sites) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < 9) dirt += clamp01((9 - d) / 5) * 0.7; // worn ground at buildings
    }
    const pd = pathDist(x, z);
    if (pd < 2.4) dirt += clamp01((2.4 - pd) / 1.5) * 0.85; // worn paths
    rock = Math.min(rock, 1.5);
    dirt = Math.min(dirt, 1.5);
    const grass = Math.max(0, 1 - rock - dirt);
    const sum = grass + dirt + rock;
    splat[i * 3] = grass / sum;
    splat[i * 3 + 1] = dirt / sum;
    splat[i * 3 + 2] = rock / sum;

    // macro tint only - the texture layers carry the detail
    const n1 = tint(x * 0.015, z * 0.015, 3);
    const n2 = tint(x * 0.07, z * 0.07, 2);
    let b = 0.88 + n1 * 0.18 + n2 * 0.07;
    if (y < WATER_Y) b *= clamp01(1 + (y - WATER_Y) * 0.35); // darken the bed
    colors[i * 3] = b * (1 + n1 * 0.05);
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b * (1 - n1 * 0.05);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("splat", new THREE.BufferAttribute(splat, 3));

  // R = terrain height, G = grass density; sampled by the near-field grass shader
  const HT = RES + 1;
  const hdata = new Float32Array(HT * HT * 4);
  for (let i = 0; i < pos.count; i++) {
    hdata[i * 4] = pos.getY(i);
    hdata[i * 4 + 1] = splat[i * 3];
  }
  const heightTex = new THREE.DataTexture(
    hdata,
    HT,
    HT,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  const T = groundTextureSet(hf.seed);
  for (const l of [T.grass, T.dirt, T.rock]) {
    l.map.anisotropy = anisotropy;
    l.nor.anisotropy = anisotropy;
  }

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    normalMap: T.grass.nor, // enables the tangent-space normal path; shader blends its own
    roughness: 1,
    metalness: 0,
  });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      tGrass: { value: T.grass.map },
      tGrassN: { value: T.grass.nor },
      tDirt: { value: T.dirt.map },
      tDirtN: { value: T.dirt.nor },
      tRock: { value: T.rock.map },
      tRockN: { value: T.rock.nor },
      tBreak: { value: T.breakup },
      tCaustic: { value: causticTexture(hf.seed) },
      uTime,
    });
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying float vWy;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvSplat = splat;\nvWy = transformed.y;",
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tGrass, tGrassN, tDirt, tDirtN, tRock, tRockN, tBreak, tCaustic;
        uniform float uTime;
        varying vec3 vSplat;
        varying float vWy;`,
      )
      .replace("#include <color_fragment>", SPLAT_GLSL)
      .replace("#include <normal_fragment_maps>", NORMAL_GLSL)
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = roughness * dot( sw, vec3( 1.0, 0.99, 0.86 ) );",
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  const update = (t) => {
    uTime.value = t;
  };
  return { mesh, heightTex, update };
}

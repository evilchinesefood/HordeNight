import * as THREE from "three";
import { WORLD_SIZE, HALF } from "../Core/Heightfield.js";
import { groundTextureSet, causticTexture } from "../Engine/Textures.js";
import { fillTerrain, makeGridSampler } from "./TerrainFill.js";

export const RES = 384; // heightTex grid: shared by the water + grass shaders

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
  float cWet = 1.0 - smoothstep( -0.35, 0.05, vWy );
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

export async function createTerrain(hf, anisotropy = 4) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RES, RES);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const n = pos.count;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pos.getX(i);
    zs[i] = pos.getZ(i);
  }
  const index = new Uint32Array(geo.index.array);

  // the two 148k-vertex fill loops run in a worker; texture generation below
  // overlaps them on the main thread (fillTerrain inline is the fallback)
  const fillP = new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL("./TerrainWorker.js", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(fillTerrain(hf.seed, xs, zs, index));
      return;
    }
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(fillTerrain(hf.seed, xs, zs, index));
    };
    worker.postMessage({ seed: hf.seed, xs, zs, index });
  });

  const T = groundTextureSet(hf.seed);
  for (const l of [T.grass, T.dirt, T.rock]) {
    l.map.anisotropy = anisotropy;
    l.nor.anisotropy = anisotropy;
  }
  // generated here, not inside onBeforeCompile: compile runs mid-first-frame
  const caustic = causticTexture(hf.seed);

  const { heights, normals, colors, splat } = await fillP;
  for (let i = 0; i < n; i++) pos.setY(i, heights[i]);
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("splat", new THREE.BufferAttribute(splat, 3));

  // placement samples the same lattice the mesh renders (bilinear)
  const gridHeightAt = makeGridSampler(heights, RES, WORLD_SIZE);

  // R = terrain height, G = grass density; sampled by the near-field grass shader
  // half-float: linear filtering of 32-bit floats needs a non-core extension
  const HT = RES + 1;
  const hdata = new Uint16Array(HT * HT * 4);
  for (let i = 0; i < n; i++) {
    hdata[i * 4] = THREE.DataUtils.toHalfFloat(heights[i]);
    hdata[i * 4 + 1] = THREE.DataUtils.toHalfFloat(splat[i * 3]);
  }
  const heightTex = new THREE.DataTexture(
    hdata,
    HT,
    HT,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

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
      tCaustic: { value: caustic },
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

  // skirt: closes residual edge sightlines (e.g. the stream notch in the rim)
  {
    const N = 96;
    const verts = [];
    const idx = [];
    const edges = [
      (t) => [-HALF + t * WORLD_SIZE, -HALF],
      (t) => [HALF, -HALF + t * WORLD_SIZE],
      (t) => [HALF - t * WORLD_SIZE, HALF],
      (t) => [-HALF, HALF - t * WORLD_SIZE],
    ];
    let base = 0;
    for (const edge of edges) {
      for (let i = 0; i <= N; i++) {
        const [x, z] = edge(i / N);
        verts.push(x, hf.heightAt(x, z) + 0.05, z, x, -25, z);
        if (i > 0) {
          const a = base + (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      base += (N + 1) * 2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    const skirt = new THREE.Mesh(
      sg,
      new THREE.MeshStandardMaterial({
        color: 0x453724,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    mesh.add(skirt);
  }

  const update = (t) => {
    uTime.value = t;
  };
  return { mesh, heightTex, update, gridHeightAt };
}

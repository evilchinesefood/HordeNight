import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";
import { placeTrees, treeParams, clearOfSites } from "../Core/Placement.js";
import { RES } from "./Terrain.js";
import {
  fluffyTuftTexture,
  softNoiseTexture,
  leafClusterTexture,
  impostorCardTexture,
} from "../Engine/Textures.js";

const CHUNKS = 10; // NxN world grid per variant so camera + shadow frustums can cull
const HANDOFF = 64; // chunk-center distance where full detail swaps to impostors
const LOD_DIST = HANDOFF + 29; // + chunk half-diagonal margin (40m cells)
const SHRUB_COUNT = 280;
const GRASS_TILE = 64;
const GRASS_COUNT = 11000;

// ez-tree presets, detail-reduced to an instancing budget (~4-5k tris/tree)
const PINE_SPECS = [
  { preset: "Pine Small", seed: 101 },
  { preset: "Pine Medium", seed: 202 },
  { preset: "Pine Medium", seed: 303 },
];
const OAK_SPECS = [
  { preset: "Oak Small", seed: 404 },
  { preset: "Ash Small", seed: 505 },
  { preset: "Oak Small", seed: 606 },
];

function buildVariant(spec) {
  const t = new Tree();
  t.loadPreset(spec.preset);
  const o = t.options;
  o.seed = spec.seed;
  o.branch.sections = { 0: 4, 1: 3, 2: 2, 3: 2 };
  o.branch.segments = { 0: 6, 1: 4, 2: 3, 3: 3 };
  o.leaves.count = Math.min(o.leaves.count, 7);
  o.leaves.size *= 2.1;
  t.generate();
  t.leavesMesh.material.dispose(); // replaced by procedural leaf textures
  t.branchesMesh.geometry.computeBoundingBox();
  // ez-tree double-billboard leaves share verts between opposing quads, so
  // computeVertexNormals averages to zero -> NaN lighting on real GPUs.
  // Radial outward normals fix that and shade the canopy like a volume.
  {
    const geo = t.leavesMesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i) * 0.25, pos.getZ(i));
      if (v.lengthSq() < 1e-6) v.set(0, 1, 0);
      v.normalize();
      nor.setXYZ(i, v.x, v.y + 0.45, v.z);
    }
    nor.needsUpdate = true;
  }
  return {
    branchGeo: t.branchesMesh.geometry,
    branchSrcMat: t.branchesMesh.material,
    leafGeo: t.leavesMesh.geometry,
    height: t.branchesMesh.geometry.boundingBox.max.y,
    baseRadius: o.branch.radius[0],
  };
}

// render a tree variant to a small RT: impostor cards get the real
// silhouette + colors instead of a painted approximation
function bakeImpostorTexture(renderer, src) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.4);
  sun.position.set(1.5, 2.5, 2);
  scene.add(sun);
  const leafBake = new THREE.MeshStandardMaterial({
    map: src.leafMap,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  scene.add(new THREE.Mesh(src.branchGeo, src.barkMat));
  scene.add(new THREE.Mesh(src.leafGeo, leafBake));
  const w = src.impW * 1.04;
  const cam = new THREE.OrthographicCamera(
    -w / 2,
    w / 2,
    src.impTop * 1.02,
    0,
    0.1,
    w * 4,
  );
  cam.position.set(0, 0, w * 2);
  // mipped: far cards are heavily minified (shimmer + texture-cache thrash unmipped)
  const rt = new THREE.WebGLRenderTarget(256, 512, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x2c4020, 0); // green bleed, not black halos
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.setClearColor(prevClear, prevAlpha);
  leafBake.dispose();
  return rt.texture;
}

export function createVegetation(hf, heightTex, renderer, sunDir) {
  const rng = Mulberry(hf.seed + 31);
  const group = new THREE.Group();
  const trunkColliders = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const col = new THREE.Color();
  const uTime = { value: 0 };
  const uCamPos = { value: new THREE.Vector3() };
  const uGust = { value: 1 }; // weather scales the rolling wind fronts

  // --- tree placement (decisions + RNG draws live in Core/Placement.js) ---
  const { pines, oaks } = placeTrees(rng, hf);

  // canopy sway, instancing-safe (ez-tree's built-in wind drops instanceMatrix);
  // sway params are per-material uniforms so all variants share ONE program
  const leafSway = (mat, H) => {
    const sway = {
      uSwayLo: { value: H * 0.25 },
      uSwayHi: { value: H * 0.95 },
      uSwayAx: { value: H * 0.008 },
      uSwayAz: { value: H * 0.006 },
    };
    mat.customProgramCacheKey = () => "hn-sway";
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime }, sway);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime, uSwayLo, uSwayHi, uSwayAx, uSwayAz;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float wPh = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.27;
          float wAt = smoothstep( uSwayLo, uSwayHi, transformed.y );
          transformed.x += ( sin( uTime * 0.6 + wPh ) + 0.4 * sin( uTime * 1.7 + wPh * 1.7 ) ) * wAt * uSwayAx;
          transformed.z += cos( uTime * 0.47 + wPh * 1.3 ) * wAt * uSwayAz;`,
        );
    };
  };
  const fullChunks = [];
  const impChunks = [];
  // world-grid chunk index (frustum culling unit)
  const chunkOf = (t) =>
    Math.min(CHUNKS - 1, ((t.x + HALF) / ((HALF * 2) / CHUNKS)) | 0) * CHUNKS +
    Math.min(CHUNKS - 1, ((t.z + HALF) / ((HALF * 2) / CHUNKS)) | 0);
  // one variant per species per chunk: species cluster naturally and a near
  // chunk costs 4 draw calls instead of 12
  const variantOf = (t) => {
    const k = chunkOf(t);
    return (((k / CHUNKS) | 0) * 7 + (k % CHUNKS) * 13) % 3;
  };
  // per-species impostor instances bucketed by chunk: key -> [{x,y,z,ry,w,h,tint}]
  const impData = { pine: new Map(), oak: new Map() };
  const bakeSrc = {}; // first variant per species feeds the impostor bake

  const addTreeVariant = (spec, items, heightOf, isPine) => {
    if (!items.length) return;
    const variant = buildVariant(spec);
    const barkMat = new THREE.MeshStandardMaterial({
      map: variant.branchSrcMat.map,
      normalMap: variant.branchSrcMat.normalMap,
      aoMap: variant.branchSrcMat.aoMap,
      roughness: 1,
    });
    if (barkMat.aoMap) barkMat.aoMap.channel = 0; // ez-tree geometry has no uv1
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafClusterTexture(spec.seed, isPine),
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    leafSway(leafMat, variant.height);

    const leafDepth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: leafMat.map,
      alphaTest: 0.35,
    });

    // far impostor dims for this variant (instances collected per chunk below)
    variant.leafGeo.computeBoundingBox();
    const lb = variant.leafGeo.boundingBox;
    const impTop = Math.max(variant.height, lb.max.y);
    const impW = Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z);
    const species = isPine ? "pine" : "oak";
    if (!bakeSrc[species])
      bakeSrc[species] = {
        branchGeo: variant.branchGeo,
        barkMat,
        leafGeo: variant.leafGeo,
        leafMap: leafMat.map,
        impTop,
        impW,
      };

    const buckets = new Map();
    items.forEach((t, i) => {
      const k = chunkOf(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push([t, i]);
    });

    for (const [key, bucket] of buckets.entries()) {
      const branches = new THREE.InstancedMesh(
        variant.branchGeo,
        barkMat,
        bucket.length,
      );
      const leaves = new THREE.InstancedMesh(
        variant.leafGeo,
        leafMat,
        bucket.length,
      );
      leaves.customDepthMaterial = leafDepth;
      bucket.forEach(([t, i], j) => {
        // one stream, drawn once in Placement.treeParams: full tree and
        // impostor consume the same object, so they cannot desync
        const { rot, ys, g, red } = treeParams(i, hf.seed, spec.seed);
        const targetH = heightOf(t.s);
        const sc = targetH / variant.height;
        m.makeRotationY(rot);
        m.scale(v.set(sc, sc * ys, sc));
        m.setPosition(t.x, t.y - 0.1, t.z);
        branches.setMatrixAt(j, m);
        leaves.setMatrixAt(j, m);
        leaves.setColorAt(j, col.setRGB(red, g, g * 0.9));
        const store = impData[isPine ? "pine" : "oak"];
        if (!store.has(key)) store.set(key, []);
        store.get(key).push({
          x: t.x,
          y: t.y - 0.1,
          z: t.z,
          ry: rot,
          w: impW * sc,
          h: impTop * sc * ys,
          tint: [red, g, g * 0.9],
        });
        trunkColliders.push({
          x: t.x,
          z: t.z,
          r: variant.baseRadius * sc + 0.15,
          topY: t.y + targetH * 0.55,
        });
      });
      // alpha-tested cards stamp solid squares into the GTAO pre-passes
      // (override materials ignore alphaTest) -> AO-excluded layer 2; they
      // still cast shadows because the MAIN camera keeps layer 2 enabled
      // (three tests shadow casters against the view camera's mask)
      leaves.layers.set(2);
      for (const mesh of [branches, leaves]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      const cell = (HALF * 2) / CHUNKS;
      fullChunks.push({
        meshes: [branches, leaves],
        cx: -HALF + (((key / CHUNKS) | 0) + 0.5) * cell,
        cz: -HALF + ((key % CHUNKS) + 0.5) * cell,
      });
    }
  };

  PINE_SPECS.forEach((spec, k) =>
    addTreeVariant(
      spec,
      pines.filter((t) => variantOf(t) === k),
      (s) => 6.5 + s * 4,
      true,
    ),
  );
  OAK_SPECS.forEach((spec, k) =>
    addTreeVariant(
      spec,
      oaks.filter((t) => variantOf(t) === k),
      (s) => 5 + s * 3,
      false,
    ),
  );

  // --- far-tree impostors: unit crossed cards, chunked, species materials ---
  {
    const cardA = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const unitCard = mergeGeometries([
      cardA,
      cardA.clone().rotateY(Math.PI / 2),
    ]);
    const nor = unitCard.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
    const cell = (HALF * 2) / CHUNKS;
    for (const species of ["pine", "oak"]) {
      const mat = new THREE.MeshStandardMaterial({
        // painted fallback keeps world-gen renderer-optional (Node tests)
        map:
          renderer && bakeSrc[species]
            ? bakeImpostorTexture(renderer, bakeSrc[species])
            : impostorCardTexture(
                species === "pine" ? 3 : 4,
                species === "pine",
              ),
        alphaTest: 0.3,
        side: THREE.DoubleSide,
        roughness: 1,
      });
      for (const [key, arr] of impData[species]) {
        // per-chunk material clone (same program) so the LOD swap can dissolve
        const mesh = new THREE.InstancedMesh(unitCard, mat.clone(), arr.length);
        arr.forEach((d, j) => {
          m.makeRotationY(d.ry);
          m.scale(v.set(d.w, d.h, d.w));
          m.setPosition(d.x, d.y, d.z);
          mesh.setMatrixAt(j, m);
          mesh.setColorAt(j, col.setRGB(d.tint[0], d.tint[1], d.tint[2]));
        });
        mesh.visible = false;
        mesh.layers.set(2); // same square-stamp problem at distance
        group.add(mesh);
        impChunks.push({
          mesh,
          cx: -HALF + (((key / CHUNKS) | 0) + 0.5) * cell,
          cz: -HALF + ((key % CHUNKS) + 0.5) * cell,
        });
      }
    }
  }

  // --- FluffyGrass-style near-field grass on the camera-wrap system ---
  const quad = new THREE.PlaneGeometry(1.1, 0.95).translate(0, 0.43, 0);
  const grassGeo = mergeGeometries([quad, quad.clone().rotateY(Math.PI / 2)]);
  {
    // flat up normals: the field shades like a soft carpet
    const nor = grassGeo.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  }
  const grassMat = new THREE.MeshStandardMaterial({
    map: fluffyTuftTexture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  // hoisted: texture gen must not run inside the mid-frame compile; uSunCol
  // is reachable so the night preset can kill the warm backlight
  const grassNoise = softNoiseTexture(hf.seed);
  const uSunCol = { value: new THREE.Color(0xffe9b8) };
  grassMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime,
      uCamPos,
      uGust,
      uHeightTex: { value: heightTex },
      uNoise: { value: grassNoise },
      uBase: { value: new THREE.Color(0x36481c) },
      uTip1: { value: new THREE.Color(0xa6dd96) },
      uTip2: { value: new THREE.Color(0x3c6336) },
      uSunDir: { value: (sunDir ?? new THREE.Vector3(0, 1, 0)).clone() },
      uSunCol,
    });
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uGust;
        uniform sampler2D uHeightTex;
        uniform sampler2D uNoise;
        varying float vPatch;
        varying vec3 vGrassW;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
        mat3 gRs = mat3( instanceMatrix );
        vec2 gTuft = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
        vec2 gWp = gTuft + // NOTE: gWp.y is world Z (vec2 of xz)
         floor( ( uCamPos.xz - gTuft ) / ${GRASS_TILE}.0 + 0.5 ) * ${GRASS_TILE}.0;
        vec2 gUv = ( ( gWp + ${HALF}.0 ) / ${HALF * 2}.0 * ${RES}.0 + 0.5 ) / ${RES + 1}.0;
        vec4 gHs = texture2D( uHeightTex, gUv );
        float gDist = distance( gWp, uCamPos.xz );
        float gJit = texture2D( uNoise, gWp * 0.13 ).r - 0.5;
        float gFade = ( 1.0 - smoothstep( 18.0, 30.0, gDist ) ) * smoothstep( 0.35, 0.62, gHs.g + gJit * 0.35 );
        gFade *= 1.0 - step( ${HALF - 2}.0, max( abs( gWp.x ), abs( gWp.y ) ) );
        transformed = gRs * transformed * gFade;
        float gBend = uv.y * uv.y * gFade;
        float gGust = texture2D( uNoise, gWp * 0.011 + uTime * 0.013 ).r - 0.5;
        transformed.x += ( sin( uTime * 1.6 + gWp.x * 0.9 + gWp.y * 0.8 ) + gGust * 2.6 ) * gBend * 0.13;
        transformed.z += ( cos( uTime * 1.2 + gWp.x * 0.7 ) + gGust * 2.0 ) * gBend * 0.1;
        // rolling gust fronts: directional phase + drifting noise envelope
        vec2 gWdir = vec2( 0.78, 0.63 );
        float gEnv = smoothstep( 0.35, 0.75,
          texture2D( uNoise, gWp * 0.008 + gWdir * uTime * 0.021 ).r ) * uGust;
        transformed.xz += gWdir * sin( dot( gWp, gWdir ) * 0.14 + uTime * 1.9 ) * gEnv * gBend * 0.5;
        // player walks through: tufts part aside and press down
        vec2 gToB = gWp - uCamPos.xz;
        float gPd = max( length( gToB ), 0.001 );
        float gPush = 1.0 - smoothstep( 0.0, 1.3, gPd );
        gPush *= gPush * uv.y * uv.y;
        transformed.xz += ( gToB / gPd ) * gPush * 0.55;
        transformed.y -= gPush * 0.3;
        transformed += vec3( gWp.x, gHs.r, gWp.y );
        vGrassW = transformed;
        vPatch = texture2D( uNoise, gWp * 0.016 ).r;`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
        #endif`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uBase;
        uniform vec3 uTip1;
        uniform vec3 uTip2;
        uniform vec3 uSunDir;
        uniform vec3 uSunCol;
        varying float vPatch;
        varying vec3 vGrassW;`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 gTuftTexel = texture2D( map, vMapUv );
        vec3 gTip = mix( uTip1, uTip2, smoothstep( 0.2, 0.8, vPatch ) );
        diffuseColor.rgb = mix( uBase, gTip, smoothstep( 0.05, 1.0, vMapUv.y ) ) * gTuftTexel.r;
        // roots sit in shadowed thatch
        diffuseColor.rgb *= 0.55 + 0.45 * smoothstep( 0.0, 0.45, vMapUv.y );
        diffuseColor.a = gTuftTexel.a;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // backlit tips: sun glows through blades when it sits behind them
        vec3 gV = normalize( cameraPosition - vGrassW );
        float gSss = pow( max( dot( -gV, uSunDir ), 0.0 ), 3.0 );
        totalEmissiveRadiance += uSunCol * gSss * smoothstep( 0.3, 1.0, vMapUv.y ) * gTuftTexel.r * 0.3;`,
      );
  };

  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  for (let i = 0; i < GRASS_COUNT; i++) {
    const s = 0.55 + rng() * 0.75;
    m.makeRotationY(rng() * Math.PI * 2);
    // height spread: 30%..100% of the old max (1.3), same draw count
    m.scale(v.set(s, s * 1.3 * (0.3 + rng() * 0.7), s));
    m.setPosition((rng() - 0.5) * GRASS_TILE, 0, (rng() - 0.5) * GRASS_TILE);
    grass.setMatrixAt(i, m);
  }
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  grass.layers.set(2); // AO-excluded: override materials drop the wrap shader
  group.add(grass);

  // --- bushes: crossed leaf-cluster cards, mini tree canopies ---
  const bushCard = new THREE.PlaneGeometry(1.7, 1.2).translate(0, 0.5, 0);
  const bushGeo = mergeGeometries([
    bushCard,
    bushCard.clone().rotateY(Math.PI / 3),
    bushCard.clone().rotateY((Math.PI * 2) / 3),
  ]);
  {
    const nor = bushGeo.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  }
  const bushMat = new THREE.MeshStandardMaterial({
    map: leafClusterTexture(hf.seed + 63, false),
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  leafSway(bushMat, 1.2);
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, SHRUB_COUNT);
  bushes.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: bushMat.map,
    alphaTest: 0.35,
  });
  let sp = 0;
  for (let i = 0; i < SHRUB_COUNT * 5 && sp < SHRUB_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.4) continue;
    if (!clearOfSites(hf, x, z, 9)) continue;
    const s = 0.55 + rng() * 1.0;
    m.makeRotationY(rng() * Math.PI * 2);
    m.scale(v.set(s, s * (0.8 + rng() * 0.35), s));
    m.setPosition(x, y - 0.06, z);
    bushes.setMatrixAt(sp, m);
    bushes.setColorAt(
      sp,
      col.setRGB(0.85 + rng() * 0.35, 0.9 + rng() * 0.3, 0.8 + rng() * 0.25),
    );
    sp++;
  }
  bushes.count = sp;
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  bushes.layers.set(2); // alpha cards: AO-excluded (shadows via the main camera's mask)
  group.add(bushes);

  // LOD records grouped by unique chunk center: one distance test per chunk,
  // +/-4m hysteresis, and skipped entirely until the player moves 2m
  const lodGroups = new Map();
  for (const c of fullChunks) {
    const k = `${c.cx},${c.cz}`;
    if (!lodGroups.has(k))
      lodGroups.set(k, {
        cx: c.cx,
        cz: c.cz,
        full: [],
        imp: [],
        on: undefined,
        fade: 0,
      });
    lodGroups.get(k).full.push(...c.meshes);
  }
  for (const c of impChunks) {
    const k = `${c.cx},${c.cz}`;
    if (!lodGroups.has(k))
      lodGroups.set(k, {
        cx: c.cx,
        cz: c.cz,
        full: [],
        imp: [],
        on: undefined,
        fade: 0,
      });
    lodGroups.get(k).imp.push(c.mesh);
  }
  let lodX = 1e9;
  let lodZ = 1e9;
  let lastT = 0;
  const fading = new Set();
  const FADE = 3.2; // dissolve speed (1/s)
  const update = (t, camPos, gust = 1) => {
    uTime.value = t;
    uGust.value = gust;
    const dt = Math.max(0, Math.min(t - lastT, 0.1));
    lastT = t;
    if (!camPos) return;
    uCamPos.value.copy(camPos);
    if ((camPos.x - lodX) ** 2 + (camPos.z - lodZ) ** 2 >= 4) {
      lodX = camPos.x;
      lodZ = camPos.z;
      for (const g of lodGroups.values()) {
        const d2 = (camPos.x - g.cx) ** 2 + (camPos.z - g.cz) ** 2;
        const on =
          g.on === undefined
            ? d2 < LOD_DIST * LOD_DIST
            : g.on
              ? d2 < (LOD_DIST + 4) ** 2
              : d2 < (LOD_DIST - 4) ** 2;
        if (on === g.on) continue;
        const first = g.on === undefined;
        g.on = on;
        if (first) {
          // initial state: no dissolve
          for (const mesh of g.full) mesh.visible = on;
          for (const mesh of g.imp) mesh.visible = !on;
          g.fade = on ? 0 : 1; // steady-state impostor opacity
          continue;
        }
        // cross-dissolve: full trees stay while the impostor fades in/out.
        // transparent needs needsUpdate (program swap off the OPAQUE define)
        // and a tiny alphaTest so the fade survives below the 0.3 cutoff
        for (const mesh of g.full) mesh.visible = true;
        for (const mesh of g.imp) {
          mesh.visible = true;
          const mat = mesh.material;
          mat.transparent = true;
          mat.alphaTest = 0.02;
          mat.needsUpdate = true;
        }
        fading.add(g);
      }
    }
    for (const g of fading) {
      g.fade += (g.on ? -1 : 1) * FADE * dt;
      const done = g.on ? g.fade <= 0 : g.fade >= 1;
      if (done) {
        g.fade = g.on ? 0 : 1;
        fading.delete(g);
        for (const mesh of g.full) mesh.visible = g.on;
        for (const mesh of g.imp) {
          mesh.visible = !g.on;
          const mat = mesh.material;
          mat.transparent = false;
          mat.alphaTest = 0.3;
          mat.opacity = 1;
          mat.needsUpdate = true;
        }
        continue;
      }
      for (const mesh of g.imp) mesh.material.opacity = g.fade;
    }
  };
  // night preset: kill the warm sun-through-blades backlight
  const setNight = (on) => uSunCol.value.set(on ? 0x2c3a55 : 0xffe9b8);

  // drop build-only intermediates: the returned closures would otherwise pin
  // the whole factory context (placement arrays, cell keys) for the session
  pines.length = 0;
  oaks.length = 0;
  cells.clear();
  impData.pine.clear();
  impData.oak.clear();

  return { group, trunkColliders, update, setNight };
}

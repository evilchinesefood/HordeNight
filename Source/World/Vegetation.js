import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";
import {
  fluffyTuftTexture,
  softNoiseTexture,
  leafClusterTexture,
  impostorCardTexture,
} from "../Engine/Textures.js";

const TREE_TRIES = 9000;
const TREE_CELL = 5;
const TREE_CAP = 1500;
const CHUNKS = 8; // NxN world grid per variant so camera + shadow frustums can cull
const HANDOFF = 88; // chunk-center distance where full detail swaps to impostors
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
    leafSrcMat: t.leavesMesh.material,
    height: t.branchesMesh.geometry.boundingBox.max.y,
    baseRadius: o.branch.radius[0],
  };
}

export function createVegetation(hf, heightTex) {
  const rng = Mulberry(hf.seed + 31);
  const group = new THREE.Group();
  const trunkColliders = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const col = new THREE.Color();
  const uTime = { value: 0 };
  const uCamPos = { value: new THREE.Vector3() };

  const clearOfSites = (x, z, pad) =>
    hf.sites.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > pad * pad);

  // --- tree placement ---
  const pines = [];
  const oaks = [];
  const cells = new Set();
  for (let i = 0; i < TREE_TRIES; i++) {
    if (pines.length + oaks.length >= TREE_CAP) break;
    const x = (rng() * 2 - 1) * (HALF - 12);
    const z = (rng() * 2 - 1) * (HALF - 12);
    const key = `${(x / TREE_CELL) | 0},${(z / TREE_CELL) | 0}`;
    if (cells.has(key)) continue;
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.8) continue;
    const slope = Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z));
    if (slope > 1.7) continue;
    if (!clearOfSites(x, z, 13)) continue;
    cells.add(key);
    (rng() < 0.55 ? pines : oaks).push({ x, y, z, s: 0.75 + rng() * 0.75 });
  }

  // canopy sway, instancing-safe (ez-tree's built-in wind drops instanceMatrix)
  const leafSway = (mat, H) => {
    mat.customProgramCacheKey = () => `hn-sway-${H.toFixed(1)}`;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float wPh = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.27;
          float wAt = smoothstep( ${(H * 0.25).toFixed(1)}, ${(H * 0.95).toFixed(1)}, transformed.y );
          transformed.x += ( sin( uTime * 0.6 + wPh ) + 0.4 * sin( uTime * 1.7 + wPh * 1.7 ) ) * wAt * ${(H * 0.008).toFixed(2)};
          transformed.z += cos( uTime * 0.47 + wPh * 1.3 ) * wAt * ${(H * 0.006).toFixed(2)};`,
        );
    };
  };
  const fullChunks = [];
  const impChunks = [];
  // per-species impostor instances bucketed by chunk: key -> [{x,y,z,ry,w,h,tint}]
  const impData = { pine: new Map(), oak: new Map() };

  const addTreeVariant = (spec, items, heightOf, isPine) => {
    if (!items.length) return;
    const variant = buildVariant(spec);
    const barkMat = new THREE.MeshStandardMaterial({
      map: variant.branchSrcMat.map,
      normalMap: variant.branchSrcMat.normalMap,
      aoMap: variant.branchSrcMat.aoMap,
      roughness: 1,
    });
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

    // bucket instances into world-grid chunks so frustum culling works
    const chunkOf = (t) =>
      Math.min(CHUNKS - 1, ((t.x + HALF) / ((HALF * 2) / CHUNKS)) | 0) *
        CHUNKS +
      Math.min(CHUNKS - 1, ((t.z + HALF) / ((HALF * 2) / CHUNKS)) | 0);
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
        const r = Mulberry(i * 7 + hf.seed + spec.seed);
        const targetH = heightOf(t.s);
        const sc = targetH / variant.height;
        m.makeRotationY(r() * Math.PI * 2);
        m.scale(v.set(sc, sc * (0.92 + r() * 0.16), sc));
        m.setPosition(t.x, t.y - 0.1, t.z);
        branches.setMatrixAt(j, m);
        leaves.setMatrixAt(j, m);
        const g = 0.95 + r() * 0.3;
        leaves.setColorAt(j, col.setRGB(g * (0.95 + r() * 0.1), g, g * 0.9));
        const store = impData[isPine ? "pine" : "oak"];
        if (!store.has(key)) store.set(key, []);
        store.get(key).push({
          x: t.x,
          y: t.y - 0.1,
          z: t.z,
          ry: Mulberry(i * 7 + hf.seed + spec.seed)() * Math.PI * 2,
          w: impW * sc,
          h: impTop * sc,
          tint: [g * (0.95 + r() * 0.1), g, g * 0.9],
        });
        trunkColliders.push({
          x: t.x,
          z: t.z,
          r: variant.baseRadius * sc + 0.15,
          topY: t.y + targetH * 0.55,
        });
      });
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
      pines.filter((_, i) => i % 3 === k),
      (s) => 6.5 + s * 4,
      true,
    ),
  );
  OAK_SPECS.forEach((spec, k) =>
    addTreeVariant(
      spec,
      oaks.filter((_, i) => i % 3 === k),
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
        map: impostorCardTexture(
          species === "pine" ? 3 : 4,
          species === "pine",
        ),
        alphaTest: 0.3,
        side: THREE.DoubleSide,
        roughness: 1,
      });
      for (const [key, arr] of impData[species]) {
        const mesh = new THREE.InstancedMesh(unitCard, mat, arr.length);
        arr.forEach((d, j) => {
          m.makeRotationY(d.ry);
          m.scale(v.set(d.w, d.h, d.w));
          m.setPosition(d.x, d.y, d.z);
          mesh.setMatrixAt(j, m);
          mesh.setColorAt(j, col.setRGB(d.tint[0], d.tint[1], d.tint[2]));
        });
        mesh.visible = false;
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
  grassMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime,
      uCamPos,
      uHeightTex: { value: heightTex },
      uNoise: { value: softNoiseTexture(hf.seed) },
      uBase: { value: new THREE.Color(0x36481c) },
      uTip1: { value: new THREE.Color(0xa6dd96) },
      uTip2: { value: new THREE.Color(0x3c6336) },
    });
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform sampler2D uHeightTex;
        uniform sampler2D uNoise;
        varying float vPatch;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
        mat3 gRs = mat3( instanceMatrix );
        vec2 gTuft = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
        vec2 gWp = gTuft + floor( ( uCamPos.xz - gTuft ) / ${GRASS_TILE}.0 + 0.5 ) * ${GRASS_TILE}.0;
        vec2 gUv = ( ( gWp + ${HALF}.0 ) / ${HALF * 2}.0 * 384.0 + 0.5 ) / 385.0;
        vec4 gHs = texture2D( uHeightTex, gUv );
        float gDist = distance( gWp, uCamPos.xz );
        float gFade = ( 1.0 - smoothstep( 14.0, 25.0, gDist ) ) * smoothstep( 0.3, 0.55, gHs.g );
        gFade *= 1.0 - step( 198.0, max( abs( gWp.x ), abs( gWp.y ) ) );
        transformed = gRs * transformed * gFade;
        float gBend = uv.y * uv.y * gFade;
        float gGust = texture2D( uNoise, gWp * 0.011 + uTime * 0.013 ).r - 0.5;
        transformed.x += ( sin( uTime * 1.6 + gWp.x * 0.9 + gWp.y * 0.8 ) + gGust * 2.6 ) * gBend * 0.13;
        transformed.z += ( cos( uTime * 1.2 + gWp.x * 0.7 ) + gGust * 2.0 ) * gBend * 0.1;
        transformed += vec3( gWp.x, gHs.r, gWp.y );
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
        varying float vPatch;`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 gTuftTexel = texture2D( map, vMapUv );
        vec3 gTip = mix( uTip1, uTip2, smoothstep( 0.2, 0.8, vPatch ) );
        diffuseColor.rgb = mix( uBase, gTip, smoothstep( 0.05, 1.0, vMapUv.y ) ) * gTuftTexel.r;
        diffuseColor.a = gTuftTexel.a;`,
      );
  };

  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  for (let i = 0; i < GRASS_COUNT; i++) {
    const s = 0.55 + rng() * 0.75;
    m.makeRotationY(rng() * Math.PI * 2);
    m.scale(v.set(s, s * (0.8 + rng() * 0.5), s));
    m.setPosition((rng() - 0.5) * GRASS_TILE, 0, (rng() - 0.5) * GRASS_TILE);
    grass.setMatrixAt(i, m);
  }
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  group.add(grass);

  // --- shrubs ---
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1)
    .scale(1.2, 0.75, 1.2)
    .translate(0, 0.32, 0);
  const shrubMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_COUNT);
  let sp = 0;
  for (let i = 0; i < SHRUB_COUNT * 5 && sp < SHRUB_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.4) continue;
    if (!clearOfSites(x, z, 9)) continue;
    const s = 0.6 + rng() * 1.1;
    m.makeRotationY(rng() * Math.PI * 2);
    m.scale(v.set(s, s * (0.9 + rng() * 0.25), s));
    m.setPosition(x, y, z);
    shrubs.setMatrixAt(sp, m);
    shrubs.setColorAt(
      sp,
      col.setHSL(0.25 + rng() * 0.04, 0.42, 0.3 + rng() * 0.12),
    );
    sp++;
  }
  shrubs.count = sp;
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  group.add(shrubs);

  const update = (t, camPos) => {
    uTime.value = t;
    if (!camPos) return;
    uCamPos.value.copy(camPos);
    for (const c of fullChunks) {
      const vis = Math.hypot(camPos.x - c.cx, camPos.z - c.cz) < HANDOFF + 36;
      c.meshes[0].visible = vis;
      c.meshes[1].visible = vis;
    }
    for (const c of impChunks) {
      c.mesh.visible =
        Math.hypot(camPos.x - c.cx, camPos.z - c.cz) >= HANDOFF + 36;
    }
  };
  return { group, trunkColliders, update };
}

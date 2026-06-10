import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";
import { fluffyTuftTexture, softNoiseTexture } from "../Engine/Textures.js";

const TREE_TRIES = 2600;
const TREE_CELL = 6;
const SHRUB_COUNT = 280;
const GRASS_TILE = 64;
const GRASS_COUNT = 16000;

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
  o.branch.sections = { 0: 5, 1: 4, 2: 3, 3: 2 };
  o.branch.segments = { 0: 5, 1: 4, 2: 3, 3: 3 };
  o.leaves.count = Math.min(o.leaves.count, 10);
  o.leaves.size *= 1.8;
  t.generate();
  t.branchesMesh.geometry.computeBoundingBox();
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

  // tree-local sway, instancing-safe (ez-tree's built-in wind drops instanceMatrix)
  const treeSway = (mat, H) => {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = uTime;
      s.vertexShader = s.vertexShader
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

  const addTreeVariant = (spec, items, heightOf) => {
    if (!items.length) return;
    const variant = buildVariant(spec);
    const barkMat = new THREE.MeshStandardMaterial({
      map: variant.branchSrcMat.map,
      normalMap: variant.branchSrcMat.normalMap,
      aoMap: variant.branchSrcMat.aoMap,
      roughness: 1,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      map: variant.leafSrcMat.map,
      color: variant.leafSrcMat.color,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 1,
    });
    treeSway(leafMat, variant.height);

    const branches = new THREE.InstancedMesh(
      variant.branchGeo,
      barkMat,
      items.length,
    );
    const leaves = new THREE.InstancedMesh(
      variant.leafGeo,
      leafMat,
      items.length,
    );
    leaves.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: leafMat.map,
      alphaTest: 0.4,
    });
    items.forEach((t, i) => {
      const r = Mulberry(i * 7 + hf.seed + spec.seed);
      const targetH = heightOf(t.s);
      const sc = targetH / variant.height;
      m.makeRotationY(r() * Math.PI * 2);
      m.scale(v.set(sc, sc * (0.92 + r() * 0.16), sc));
      m.setPosition(t.x, t.y - 0.1, t.z);
      branches.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      const g = 0.95 + r() * 0.3;
      leaves.setColorAt(i, col.setRGB(g * (0.95 + r() * 0.1), g, g * 0.9));
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
  };

  PINE_SPECS.forEach((spec, k) =>
    addTreeVariant(
      spec,
      pines.filter((_, i) => i % 3 === k),
      (s) => 6.5 + s * 4,
    ),
  );
  OAK_SPECS.forEach((spec, k) =>
    addTreeVariant(
      spec,
      oaks.filter((_, i) => i % 3 === k),
      (s) => 5 + s * 3,
    ),
  );

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
        float gFade = ( 1.0 - smoothstep( 16.0, 28.0, gDist ) ) * smoothstep( 0.3, 0.55, gHs.g );
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
    if (camPos) uCamPos.value.copy(camPos);
  };
  return { group, trunkColliders, update };
}

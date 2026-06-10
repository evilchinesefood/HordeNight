import * as THREE from "three";
import { WORLD_SIZE, HALF, WATER_Y } from "../Core/Heightfield.js";
import { waterNormalTexture, softNoiseTexture } from "../Engine/Textures.js";

// terrain-height lookup shared with the grass shader (385x385 grid texture)
const HUV = (xz) =>
  `( ( ${xz} + ${HALF}.0 ) / ${WORLD_SIZE}.0 * 384.0 + 0.5 ) / 385.0`;

const WATER_FRAG = `
  vec2 wUv = vWPos.xz;
  vec3 wn1 = texture2D( normalMap, wUv * 0.085 + uTime * vec2( 0.030, 0.052 ) ).xyz * 2.0 - 1.0;
  vec3 wn2 = texture2D( normalMap, wUv * 0.23 - uTime * vec2( 0.043, 0.018 ) ).xyz * 2.0 - 1.0;
  vec2 wRipple = wn1.xy + wn2.xy * 0.65;

  // depth of the bed below this pixel, lookup distorted by the ripples (fake refraction)
  vec2 dUv = ${HUV("( vWPos.xz + wRipple * 0.8 )")};
  float wDepth = ${WATER_Y.toFixed(1)} - texture2D( uHeightTex, dUv ).r;
  float wDeep = smoothstep( 0.0, 2.2, wDepth );

  diffuseColor.rgb = mix( vec3( 0.25, 0.48, 0.52 ), vec3( 0.02, 0.10, 0.15 ), wDeep );
  float wAlpha = mix( 0.42, 0.93, wDeep );

  // bank foam: tight depth band broken up by two drifting noise reads
  float wBand = 1.0 - smoothstep( 0.0, 0.45, wDepth );
  float wfn = texture2D( uNoise, wUv * 0.33 + vec2( uTime * 0.05, -uTime * 0.035 ) ).r;
  float wfn2 = texture2D( uNoise, wUv * 0.12 - vec2( uTime * 0.025, uTime * 0.04 ) ).r;
  float wFoam = smoothstep( 0.52, 0.78, wfn * 0.6 + wfn2 * 0.55 + wBand * 0.45 ) * wBand;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.94, 0.92 ), wFoam );
  wAlpha = mix( wAlpha, 0.96, wFoam );

  // fresnel: grazing angles reflect the sky/fog and go opaque
  vec3 wView = normalize( cameraPosition - vWPos );
  float wFres = pow( 1.0 - max( wView.y, 0.0 ), 5.0 );
  #ifdef USE_FOG
    diffuseColor.rgb = mix( diffuseColor.rgb, fogColor, wFres * 0.35 );
  #endif
  wAlpha += wFres * ( 0.88 - wAlpha );
  diffuseColor.a = wAlpha;
`;

const WATER_NORMAL = `
  vec3 mapN = normalize( vec3( wRipple, wn1.z ) );
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
`;

export function createWater(heightTex) {
  const tex = waterNormalTexture();
  const uTime = { value: 0 };

  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    roughness: 0.28,
    metalness: 0,
    normalMap: tex,
    normalScale: new THREE.Vector2(0.3, 0.3),
    depthWrite: false,
  });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime,
      uHeightTex: { value: heightTex },
      uNoise: { value: softNoiseTexture() },
    });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform sampler2D uHeightTex;
        uniform sampler2D uNoise;
        varying vec3 vWPos;`,
      )
      .replace("#include <color_fragment>", WATER_FRAG)
      .replace("#include <normal_fragment_maps>", WATER_NORMAL);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.receiveShadow = true;

  const update = (dt) => {
    uTime.value += dt;
  };
  return { mesh, update };
}

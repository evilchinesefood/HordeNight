import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

export function createPostFx(
  renderer,
  scene,
  camera,
  { ao = true, bloom = true } = {},
) {
  const pr = renderer.getPixelRatio();
  const logical = renderer.getSize(new THREE.Vector2());
  const size = logical.clone().multiplyScalar(pr);

  // MSAA on the beauty pass so the composer doesn't reintroduce jaggies
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 2,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);
  // a custom target makes the composer adopt its PHYSICAL size as _width
  // while addPass still multiplies by pixelRatio -> every pass would run at
  // DPR^2 until the first resize; re-sync to logical units before any addPass
  composer.setSize(logical.x, logical.y);
  composer.addPass(new RenderPass(scene, camera));

  if (ao) {
    // half-res AO: halves the fill AND the two extra scene passes it renders
    const gtao = new GTAOPass(scene, camera, size.x / 2, size.y / 2);
    const gtaoSetSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => gtaoSetSize(w / 2, h / 2);
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({
      radius: 0.5,
      distanceExponent: 1.5,
      thickness: 1,
      scale: 1.5,
      samples: 12,
      distanceFallOff: 1,
    });
    // clouds (layer 1) would stamp solid quads into the AO depth/normal
    // pre-passes, which render with override materials
    const gtaoRender = gtao.render.bind(gtao);
    gtao.render = (a, b, c, d, e) => {
      camera.layers.disable(1);
      camera.layers.disable(2);
      gtaoRender(a, b, c, d, e);
      camera.layers.enable(1);
      camera.layers.enable(2);
    };
    composer.addPass(gtao);
  }

  // constructed only when used: the pass allocates its 11-target mip chain immediately
  if (bloom) composer.addPass(new UnrealBloomPass(size, 0.1, 0.25, 2.6));

  // vignette folded into OutputPass: saves a full-resolution ping-pong vs a
  // separate ShaderPass; same display-space math as VignetteShader
  const out = new OutputPass();
  const frag = out.material.fragmentShader;
  const PREC = "precision highp float;";
  if (frag.includes(PREC) && /}\s*$/.test(frag)) {
    out.material.fragmentShader = frag
      .replace(
        PREC,
        PREC + "\nuniform float uVigOffset;\nuniform float uVigDarkness;",
      )
      .replace(
        /}\s*$/,
        `vec2 vigUv = ( vUv - vec2( 0.5 ) ) * vec2( uVigOffset );
gl_FragColor = vec4( mix( gl_FragColor.rgb, vec3( 1.0 - uVigDarkness ), dot( vigUv, vigUv ) ), gl_FragColor.a );
}`,
      );
    out.uniforms.uVigOffset = { value: 1.05 };
    out.uniforms.uVigDarkness = { value: 1.12 };
    composer.addPass(out);
  } else {
    console.warn("OutputShader changed - separate vignette pass fallback");
    composer.addPass(out);
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 1.05;
    vignette.uniforms.darkness.value = 1.12;
    composer.addPass(vignette);
  }

  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    setPixelRatio: (pr) => composer.setPixelRatio(pr),
  };
}

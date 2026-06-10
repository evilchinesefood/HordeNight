import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

export function createPostFx(renderer, scene, camera) {
  const pr = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2()).multiplyScalar(pr);

  // MSAA on the beauty pass so the composer doesn't reintroduce jaggies
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({
    radius: 0.5,
    distanceExponent: 1.5,
    thickness: 1,
    scale: 1.5,
    samples: 12,
    distanceFallOff: 1,
  });
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(size, 0.13, 0.25, 1.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 1.05;
  vignette.uniforms.darkness.value = 1.12;
  composer.addPass(vignette);

  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
  };
}

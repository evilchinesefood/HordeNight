import * as THREE from "three";
import { Mulberry } from "../Core/Rng.js";

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

// near-white grain multiplied over terrain vertex colors
export function detailTexture(seed = 1) {
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(256);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 235 + rng() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function grassBladeTexture() {
  const [c, ctx] = canvas(64);
  ctx.clearRect(0, 0, 64, 64);
  const rng = Mulberry(42);
  for (let i = 0; i < 11; i++) {
    const x = 4 + rng() * 56;
    const w = 1.5 + rng() * 2;
    const h = 28 + rng() * 34;
    const lean = (rng() - 0.5) * 14;
    const g = 125 + rng() * 75;
    ctx.strokeStyle = `rgb(${g * 0.52},${g},${g * 0.36})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.quadraticCurveTo(x + lean * 0.4, 64 - h * 0.6, x + lean, 64 - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// normal map from noise heights for the water surface
export function waterNormalTexture(seed = 5) {
  const rng = Mulberry(seed);
  const S = 128;
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = rng();
  // blur for smooth ripples
  const blur = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          sum += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
      blur[y * S + x] = sum / 25;
    }
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = blur[y * S + ((x + 1) % S)] - blur[y * S + ((x - 1 + S) % S)];
      const dy = blur[((y + 1) % S) * S + x] - blur[((y - 1 + S) % S) * S + x];
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 600;
      img.data[i + 1] = 128 + dy * 600;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

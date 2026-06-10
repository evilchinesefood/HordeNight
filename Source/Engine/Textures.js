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

// --- tileable ground PBR set (albedo + height->normal) ---

const TAU = Math.PI * 2;

// draws wrapped at 3x3 offsets so the texture tiles seamlessly
function wrapDot(ctx, S, x, y, r, style, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, TAU);
      ctx.fill();
    }
}

function wrapStroke(ctx, S, pts, style, alpha, width) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let i = 1; i < pts.length; i++)
        ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy);
      ctx.stroke();
    }
}

function heightToNormalCanvas(hctx, S, strength) {
  const hd = hctx.getImageData(0, 0, S, S).data;
  const at = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * S + x) * 4;
      img.data[i] = 128 - dx * inv * 127;
      img.data[i + 1] = 128 - dy * inv * 127;
      img.data[i + 2] = inv * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLayer(seed, S, base, build, normalStrength) {
  const rng = Mulberry(seed);
  const [ac, actx] = canvas(S);
  const [, hctx] = canvas(S);
  actx.fillStyle = base;
  actx.fillRect(0, 0, S, S);
  hctx.fillStyle = "rgb(128,128,128)";
  hctx.fillRect(0, 0, S, S);
  build(actx, hctx, rng, S);
  actx.globalAlpha = hctx.globalAlpha = 1;
  return {
    map: tex(ac, true),
    nor: tex(heightToNormalCanvas(hctx, S, normalStrength), false),
  };
}

export function groundTextureSet(seed = 7) {
  const S = 256;
  const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

  const grass = makeLayer(
    seed + 1,
    S,
    "#5a7030",
    (a, h, rng) => {
      for (let i = 0; i < 700; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 1.5 + rng() * 2.5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#46591f", "#3e5526", "#52682c"]),
          0.5,
        );
        wrapDot(h, S, x, y, r, "rgb(110,110,110)", 0.4);
      }
      for (let i = 0; i < 300; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 1 + rng() * 1.5;
        wrapDot(a, S, x, y, r, pick(rng, ["#79903c", "#88994a"]), 0.55);
        wrapDot(h, S, x, y, r, "rgb(150,150,150)", 0.4);
      }
    },
    1.4,
  );

  const dirt = makeLayer(
    seed + 2,
    S,
    "#765e42",
    (a, h, rng) => {
      for (let i = 0; i < 320; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 3 + rng() * 5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#5e4a32", "#654f36", "#52402c"]),
          0.4,
        );
        wrapDot(h, S, x, y, r, "rgb(112,112,112)", 0.35);
      }
      for (let i = 0; i < 240; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 0.8 + rng() * 1.5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#8a755a", "#97825f", "#6b573d"]),
          0.85,
        );
        wrapDot(h, S, x, y, r, "rgb(178,178,178)", 0.85);
      }
    },
    2.6,
  );

  const rock = makeLayer(
    seed + 3,
    S,
    "#7f7d78",
    (a, h, rng) => {
      for (let i = 0; i < 90; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 8 + rng() * 14;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#6b6a66", "#8f8d88", "#76746f"]),
          0.25,
        );
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(116,116,116)" : "rgb(142,142,142)",
          0.3,
        );
      }
      for (let i = 0; i < 26; i++) {
        const pts = [[rng() * S, rng() * S]];
        for (let sgm = 0; sgm < 3 + rng() * 3; sgm++) {
          const [px, py] = pts[pts.length - 1];
          const ang = rng() * TAU;
          const len = 10 + rng() * 22;
          pts.push([px + Math.cos(ang) * len, py + Math.sin(ang) * len]);
        }
        wrapStroke(a, S, pts, "#56544f", 0.55, 1 + rng() * 1.2);
        wrapStroke(h, S, pts, "rgb(95,95,95)", 0.7, 1.5 + rng() * 1.5);
      }
      for (let i = 0; i < 250; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 0.6 + rng();
        wrapDot(a, S, x, y, r, rng() < 0.5 ? "#93918c" : "#67655f", 0.6);
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(160,160,160)" : "rgb(104,104,104)",
          0.6,
        );
      }
    },
    3.2,
  );

  // smooth mid-gray noise used to jitter splat boundaries per-pixel
  const rng = Mulberry(seed + 4);
  const [bc, bctx] = canvas(128);
  bctx.fillStyle = "rgb(128,128,128)";
  bctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 70 + rng() * 116;
    wrapDot(
      bctx,
      128,
      rng() * 128,
      rng() * 128,
      2 + rng() * 7,
      `rgb(${v},${v},${v})`,
      0.3,
    );
  }
  return { grass, dirt, rock, breakup: tex(bc, false) };
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

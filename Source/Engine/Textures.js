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
  const S = 128;
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const rng = Mulberry(42);
  for (let i = 0; i < 26; i++) {
    const x = 6 + rng() * (S - 12);
    const w = 2 + rng() * 3;
    const h = 50 + rng() * 70;
    const lean = (rng() - 0.5) * 30;
    const g = 125 + rng() * 75;
    ctx.strokeStyle = `rgb(${g * 0.52},${g},${g * 0.36})`;
    ctx.lineCap = "round";
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.quadraticCurveTo(x + lean * 0.4, S - h * 0.6, x + lean, S - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// vertical bark streaks, tiles horizontally around the trunk
export function barkTexture(seed = 9) {
  const S = 128;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#6b5640";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rng() * S;
    const w = 1 + rng() * 3;
    const dark = rng() < 0.6;
    ctx.strokeStyle = dark
      ? `rgba(58,44,30,${0.25 + rng() * 0.3})`
      : `rgba(140,116,84,${0.2 + rng() * 0.25})`;
    ctx.lineWidth = w;
    for (const dx of [-S, 0, S]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, -4);
      ctx.bezierCurveTo(
        x + dx + (rng() - 0.5) * 10,
        S * 0.33,
        x + dx + (rng() - 0.5) * 10,
        S * 0.66,
        x + dx + (rng() - 0.5) * 8,
        S + 4,
      );
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// irregular cluster of small leaves on transparent bg (oak canopy card)
export function leafCardTexture(seed = 11) {
  const S = 128;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const C = S / 2;
  for (let i = 0; i < 240; i++) {
    const a = rng() * Math.PI * 2;
    const d =
      Math.sqrt(rng()) * (S * 0.46) * (0.75 + 0.25 * Math.sin(a * 3 + seed));
    const x = C + Math.cos(a) * d;
    const y = C + Math.sin(a) * d * 0.92;
    const r = 2.5 + rng() * 4;
    const g = 95 + rng() * 75;
    ctx.fillStyle = `rgb(${g * 0.58},${g},${g * 0.42})`;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      r,
      r * (0.6 + rng() * 0.4),
      rng() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// drooping needle fan on transparent bg (pine branch card)
export function pineCardTexture(seed = 13) {
  const S = 128;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = "round";
  // central stem
  ctx.strokeStyle = "#4c3b28";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(S / 2, 4);
  ctx.lineTo(S / 2, S - 18);
  ctx.stroke();
  for (let i = 0; i < 150; i++) {
    const t = rng();
    const y = 8 + t * (S - 30);
    const side = rng() < 0.5 ? -1 : 1;
    const len = (14 + rng() * 22) * (1 - t * 0.35);
    const droop = 6 + rng() * 14;
    const g = 85 + rng() * 65;
    ctx.strokeStyle = `rgb(${g * 0.5},${g},${g * 0.45})`;
    ctx.lineWidth = 1.5 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(S / 2, y);
    ctx.quadraticCurveTo(
      S / 2 + side * len * 0.6,
      y + droop * 0.3,
      S / 2 + side * len,
      y + droop,
    );
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

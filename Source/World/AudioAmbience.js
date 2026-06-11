// procedural WebAudio ambience: wind, birds, and water that swells near the stream

function noiseBuffer(ctx, seconds, brown) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = Math.max(-1, Math.min(1, last * 3.5));
      } else {
        d[i] = white;
      }
    }
  }
  return buf;
}

export class AudioAmbience {
  constructor() {
    this.started = false;
    this.birdTimer = 4;
  }

  start() {
    if (this.started) {
      // recovery gesture: Safari parks contexts in suspended/interrupted
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume();
      return;
    }
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return; // no audio support - play silent
    }
    this.started = true;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    // compressor keeps stacked gunshots from clipping the mix
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);
    // flat white loop enveloped at play time (gunshot crack/tail layers)
    this.shotBuf = noiseBuffer(ctx, 0.5, false);

    // wind: slow-breathing filtered brown noise
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 6, true);
    wind.loop = true;
    const windLp = ctx.createBiquadFilter();
    windLp.type = "lowpass";
    windLp.frequency.value = 360;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.07;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    wind.connect(windLp).connect(this.windGain).connect(this.master);
    wind.start();
    lfo.start();

    // water: band-passed noise, gain driven by distance to the stream
    const water = ctx.createBufferSource();
    water.buffer = noiseBuffer(ctx, 4, false);
    water.loop = true;
    // short decaying noise burst reused for footsteps and landings
    const sb = ctx.createBuffer(1, (ctx.sampleRate * 0.12) | 0, ctx.sampleRate);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) {
      sd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sd.length, 2.2);
    }
    this.stepBuf = sb;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(bp).connect(this.waterGain).connect(this.master);
    water.start();

    // rain: lowpassed reuse of the white-noise loop, offset to decorrelate
    const rain = ctx.createBufferSource();
    rain.buffer = water.buffer;
    rain.loop = true;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = "lowpass";
    rainLp.frequency.value = 2600;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainLp).connect(this.rainGain).connect(this.master);
    rain.start(0, 1.7);
    if (ctx.state !== "running") ctx.resume();
  }

  thud(rate, freq, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.stepBuf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime);
  }

  step(sprint) {
    if (!this.started) return;
    this.thud(
      0.8 + Math.random() * 0.35,
      320 + Math.random() * 180 + (sprint ? 140 : 0),
      sprint ? 0.34 : 0.22,
    );
  }

  land(speed) {
    if (!this.started) return;
    this.thud(0.5, 240, Math.min(0.55, 0.1 + speed * 0.045));
  }

  // enveloped noise layer for gunshots/clicks (offset+loop for variety)
  _burst({ rate = 1, type = "lowpass", freq, vol, dur, at = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.shotBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.05);
  }

  // layered gunshot: highpassed attack crack + pitch-dropping sine boom +
  // lowpassed air tail; per-weapon voicing, slight random detune
  shot(kind) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const det = 0.9 + Math.random() * 0.2;
    // prettier-ignore
    const P = {
      pistol:  { hp: 1700, cv: 0.55, ct: 0.04, f0: 160, f1: 58, bt: 0.09, bv: 0.5,  tv: 0.18, tt: 0.22, lp: 1400 },
      shotgun: { hp: 900,  cv: 0.6,  ct: 0.05, f0: 115, f1: 38, bt: 0.17, bv: 0.9,  tv: 0.32, tt: 0.42, lp: 850 },
      rifle:   { hp: 2100, cv: 0.5,  ct: 0.03, f0: 175, f1: 70, bt: 0.07, bv: 0.42, tv: 0.2,  tt: 0.26, lp: 1600 },
    }[kind] ?? { hp: 1700, cv: 0.55, ct: 0.04, f0: 160, f1: 58, bt: 0.09, bv: 0.5, tv: 0.18, tt: 0.22, lp: 1400 };
    this._burst({
      rate: det * 1.6,
      type: "highpass",
      freq: P.hp,
      vol: P.cv,
      dur: P.ct,
    });
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(P.f0 * det, t0);
    osc.frequency.exponentialRampToValueAtTime(P.f1, t0 + P.bt);
    const og = ctx.createGain();
    og.gain.setValueAtTime(P.bv, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + P.bt * 1.6);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + P.bt * 1.6 + 0.05);
    this._burst({ rate: det, freq: P.lp, vol: P.tv, dur: P.tt });
  }

  // dry-fire / equipment tick
  click() {
    if (this.started)
      this._burst({
        rate: 2.5,
        type: "highpass",
        freq: 2400,
        vol: 0.14,
        dur: 0.03,
      });
  }

  // two quick mechanical ticks bracket a reload
  reloadClick() {
    if (!this.started) return;
    this._burst({
      rate: 1.8,
      type: "highpass",
      freq: 1500,
      vol: 0.18,
      dur: 0.04,
    });
    this._burst({
      rate: 2.2,
      type: "highpass",
      freq: 1900,
      vol: 0.15,
      dur: 0.035,
      at: 0.08,
    });
  }

  swing() {
    if (this.started) this.thud(2.2, 900, 0.22);
  }

  thwack() {
    if (this.started) this.thud(1.1, 650, 0.5);
  }

  chirp() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    const notes = 2 + ((Math.random() * 3) | 0);
    for (let n = 0; n < notes; n++) {
      const t = t0 + n * (0.12 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const f = 2300 + Math.random() * 1600;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(
        f * (0.8 + Math.random() * 0.5),
        t + 0.09,
      );
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g).connect(pan);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  // rain: audible streak mix (fades indoors); storm: raw weather intensity
  update(dt, streamDistance, rain = 0, storm = rain) {
    if (!this.started) return;
    this.waterTimer = (this.waterTimer || 0) - dt;
    if (this.waterTimer <= 0) {
      this.waterTimer = 0.2;
      const target = 0.4 * Math.max(0, 1 - streamDistance / 45) ** 2;
      this.waterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
      // rain follows the VISIBLE mix, so it muffles to silence indoors
      this.rainGain.gain.setTargetAtTime(
        rain * 0.26,
        this.ctx.currentTime,
        0.5,
      );
    }
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 8;
      if (storm < 0.15) this.chirp(); // birds shelter while it rains
    }
  }
}

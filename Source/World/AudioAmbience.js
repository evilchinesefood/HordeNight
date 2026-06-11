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
    this.master.connect(ctx.destination);

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

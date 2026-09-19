import { Jungle } from "./jungle";
import { DEFAULT_PARAMS, type ChainParams } from "./presets";

const VOCODER_BANDS = [120, 220, 400, 700, 1200, 2000, 3400, 5500];

export type FileMeta = {
  name: string;
  duration: number;
};

export type MicFailure = {
  code: "denied" | "notfound" | "insecure" | "file" | "unsupported" | "unknown";
  message: string;
};

type Graph = {
  ctx: AudioContext;
  inputGain: GainNode;
  micGain: GainNode;
  fileGain: GainNode;
  pitchDry: GainNode;
  pitchWet: GainNode;
  jungle: Jungle;
  mud: BiquadFilterNode;
  presence: BiquadFilterNode;
  air: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  satDry: GainNode;
  satWet: GainNode;
  satShaper: WaveShaperNode;
  vocDry: GainNode;
  vocWet: GainNode;
  vocoderSum: GainNode;
  carrierOsc: OscillatorNode;
  carrierOscGain: GainNode;
  carrierNoise: AudioBufferSourceNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  delayDry: GainNode;
  convolver: ConvolverNode;
  reverbWet: GainNode;
  reverbDry: GainNode;
  outputGain: GainNode;
  monitorGain: GainNode;
  analyser: AnalyserNode;
  streamDest: MediaStreamAudioDestinationNode;
  envScalers: GainNode[];
};

function AudioContextCtor(): typeof AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio is not available in this browser.");
  }
  return Ctor;
}

function ramp(param: AudioParam, value: number, now: number, timeConstant = 0.04) {
  param.setTargetAtTime(value, now, timeConstant);
}

function makeDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 72 + 1;
  const n = 1024;
  const curve = new Float32Array(n) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

function makeAbsCurve(): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(n) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.abs(x);
  }
  return curve;
}

function makeNoiseBuffer(ctx: AudioContext, seconds = 1.5): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function makePlateImpulse(ctx: AudioContext, duration = 0.62, decay = 3.4): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      const early = i < ctx.sampleRate * 0.018 ? 0.55 : 1;
      data[i] = (Math.random() * 2 - 1) * env * early;
    }
  }
  return buffer;
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function describeMicError(err: unknown): MicFailure {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return {
      code: "file",
      message:
        "This page was opened as a file. Serve it over localhost (for example npx serve) or host it on https so the microphone can work.",
    };
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      code: "insecure",
      message:
        "Microphone access needs a secure page (https) or localhost. Host the app or serve it locally.",
    };
  }
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      code: "denied",
      message:
        "Microphone permission was denied. Allow the mic for this site in the browser, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "notfound",
      message: "No microphone found. Plug one in or check system input settings.",
    };
  }
  if (name === "NotSupportedError" || name === "TypeError") {
    return {
      code: "unsupported",
      message: "This browser cannot open the microphone. Try Safari or Chrome on a secure page.",
    };
  }
  const fallback = err instanceof Error && err.message ? err.message : "Could not open the microphone.";
  return { code: "unknown", message: fallback };
}

function pickRecorderMime(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export class VocalEngine {
  params: ChainParams = { ...DEFAULT_PARAMS };
  private graph: Graph | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private fileBuffer: AudioBuffer | null = null;
  private fileSource: AudioBufferSourceNode | null = null;
  private fileMeta: FileMeta | null = null;
  private loop = true;
  private mixSources = false;
  private monitorOn = true;
  private playing = false;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get analyser(): AnalyserNode | null {
    return this.graph?.analyser ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get loadedFile(): FileMeta | null {
    return this.fileMeta;
  }

  get contextState(): AudioContextState | "idle" {
    return this.graph?.ctx.state ?? "idle";
  }

  async ensureStarted(): Promise<void> {
    if (this.graph) {
      if (this.graph.ctx.state === "suspended") {
        await this.graph.ctx.resume();
      }
      return;
    }
    const Ctor = AudioContextCtor();
    if (!Ctor) {
      throw new Error("Web Audio is not available in this browser.");
    }
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.graph = this.buildGraph(ctx);
    this.applyParams(this.params);
    this.setMonitor(this.monitorOn);
  }

  async resume(): Promise<void> {
    if (this.graph && this.graph.ctx.state !== "running") {
      await this.graph.ctx.resume();
    }
  }

  async enableMic(): Promise<void> {
    await this.ensureStarted();
    const graph = this.graph!;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("getUserMedia is missing."), { name: "NotSupportedError" });
    }
    if (!window.isSecureContext && window.location.protocol !== "file:") {
      throw Object.assign(new Error("Insecure origin"), { name: "SecurityError" });
    }
    if (window.location.protocol === "file:") {
      throw Object.assign(new Error("file protocol"), { name: "SecurityError" });
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    this.disableMic();
    this.micStream = stream;
    this.micNode = graph.ctx.createMediaStreamSource(stream);
    this.micNode.connect(graph.micGain);
    if (!this.mixSources && this.playing) {
      this.stopFile();
    }
    this.routeSources();
  }

  disableMic(): void {
    if (this.micNode) {
      try {
        this.micNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.micNode = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
    if (this.graph) {
      ramp(this.graph.micGain.gain, 0, this.graph.ctx.currentTime, 0.02);
    }
  }

  get micEnabled(): boolean {
    return Boolean(this.micStream);
  }

  async loadFile(file: File): Promise<FileMeta> {
    await this.ensureStarted();
    const graph = this.graph!;
    const raw = await file.arrayBuffer();
    const copy = raw.slice(0);
    const buffer = await graph.ctx.decodeAudioData(copy);
    this.stopFile();
    this.fileBuffer = buffer;
    this.fileMeta = { name: file.name, duration: buffer.duration };
    return this.fileMeta;
  }

  playFile(): void {
    if (!this.graph || !this.fileBuffer) return;
    this.stopFile();
    if (!this.mixSources && this.micEnabled) {
      ramp(this.graph.micGain.gain, 0, this.graph.ctx.currentTime, 0.02);
    }
    const src = this.graph.ctx.createBufferSource();
    src.buffer = this.fileBuffer;
    src.loop = this.loop;
    src.connect(this.graph.fileGain);
    src.onended = () => {
      if (this.fileSource === src) {
        this.playing = false;
        this.fileSource = null;
        this.routeSources();
      }
    };
    src.start();
    this.fileSource = src;
    this.playing = true;
    this.routeSources();
  }

  stopFile(): void {
    if (this.fileSource) {
      try {
        this.fileSource.onended = null;
        this.fileSource.stop();
      } catch {
        /* already stopped */
      }
      try {
        this.fileSource.disconnect();
      } catch {
        /* already disconnected */
      }
      this.fileSource = null;
    }
    this.playing = false;
    if (this.graph) {
      ramp(this.graph.fileGain.gain, 0, this.graph.ctx.currentTime, 0.02);
    }
    this.routeSources();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.fileSource) this.fileSource.loop = loop;
  }

  setMixSources(mix: boolean): void {
    this.mixSources = mix;
    this.routeSources();
  }

  setMonitor(on: boolean): void {
    this.monitorOn = on;
    if (!this.graph) return;
    ramp(this.graph.monitorGain.gain, on ? 1 : 0, this.graph.ctx.currentTime, 0.03);
  }

  applyParams(params: ChainParams): void {
    this.params = { ...params };
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;

    ramp(g.inputGain.gain, params.input, now);
    ramp(g.outputGain.gain, params.output, now);

    const pitchAbs = Math.abs(params.pitch);
    if (pitchAbs < 0.02) {
      ramp(g.pitchDry.gain, 1, now, 0.02);
      ramp(g.pitchWet.gain, 0, now, 0.02);
    } else {
      g.jungle.setPitchOffset(params.pitch);
      ramp(g.pitchDry.gain, 0, now, 0.02);
      ramp(g.pitchWet.gain, 1, now, 0.02);
    }

    g.presence.gain.setTargetAtTime(-6 + params.presence * 16, now, 0.05);

    const amount = params.compression;
    g.compressor.threshold.setTargetAtTime(-8 - amount * 22, now, 0.05);
    g.compressor.ratio.setTargetAtTime(1.5 + amount * 7.5, now, 0.05);
    g.compressor.knee.setTargetAtTime(8 - amount * 4, now, 0.05);
    ramp(g.makeup.gain, dbToGain(amount * 6.5), now);

    g.satShaper.curve = makeDriveCurve(params.saturation);
    ramp(g.satDry.gain, 1 - params.saturation * 0.72, now);
    ramp(g.satWet.gain, params.saturation, now);

    ramp(g.vocDry.gain, 1 - params.vocoderMix, now);
    ramp(g.vocWet.gain, params.vocoderMix, now);
    g.carrierOsc.frequency.setTargetAtTime(params.carrierHz, now, 0.04);
    const envDrive = 4 + params.vocoderMix * 4;
    for (const scaler of g.envScalers) {
      ramp(scaler.gain, envDrive, now, 0.05);
    }

    ramp(g.delayWet.gain, params.delay * 0.46, now);
    ramp(g.delayDry.gain, 1 - params.delay * 0.18, now);
    ramp(g.delayFeedback.gain, 0.2 + params.delay * 0.32, now);

    ramp(g.reverbWet.gain, params.reverb * 0.48, now);
    ramp(g.reverbDry.gain, 1 - params.reverb * 0.22, now);
  }

  setParam<K extends keyof ChainParams>(key: K, value: ChainParams[K]): void {
    this.applyParams({ ...this.params, [key]: value });
  }

  startRecording(): void {
    if (!this.graph) throw new Error("Start the booth before recording.");
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Recording is not supported in this browser.");
    }
    const mime = pickRecorderMime();
    const stream = this.graph.streamDest.stream;
    this.chunks = [];
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    };
    recorder.start(250);
    this.recorder = recorder;
  }

  async stopRecording(): Promise<{ blob: Blob; mime: string }> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("Nothing is recording.");
    const mime = recorder.mimeType || "audio/webm";
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Recording failed."));
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: mime }));
      };
      if (recorder.state === "inactive") {
        resolve(new Blob(this.chunks, { type: mime }));
        return;
      }
      recorder.stop();
    });
    this.recorder = null;
    this.chunks = [];
    return { blob, mime };
  }

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  dispose(): void {
    this.stopFile();
    this.disableMic();
    if (this.recorder && this.recorder.state === "recording") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    if (this.graph) {
      try {
        this.graph.carrierOsc.stop();
        this.graph.carrierNoise.stop();
      } catch {
        /* ignore */
      }
      void this.graph.ctx.close();
      this.graph = null;
    }
  }

  private routeSources(): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    const micOn = Boolean(this.micStream);
    const fileOn = this.playing;
    if (this.mixSources) {
      ramp(g.micGain.gain, micOn ? 1 : 0, now, 0.02);
      ramp(g.fileGain.gain, fileOn ? 1 : 0, now, 0.02);
      return;
    }
    if (fileOn) {
      ramp(g.micGain.gain, 0, now, 0.02);
      ramp(g.fileGain.gain, 1, now, 0.02);
    } else if (micOn) {
      ramp(g.micGain.gain, 1, now, 0.02);
      ramp(g.fileGain.gain, 0, now, 0.02);
    } else {
      ramp(g.micGain.gain, 0, now, 0.02);
      ramp(g.fileGain.gain, 0, now, 0.02);
    }
  }

  private buildGraph(ctx: AudioContext): Graph {
    const inputGain = ctx.createGain();
    const micGain = ctx.createGain();
    const fileGain = ctx.createGain();
    micGain.gain.value = 0;
    fileGain.gain.value = 0;
    micGain.connect(inputGain);
    fileGain.connect(inputGain);

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 90;
    highpass.Q.value = 0.7;
    inputGain.connect(highpass);

    const jungle = new Jungle(ctx);
    const pitchDry = ctx.createGain();
    const pitchWet = ctx.createGain();
    const pitchSum = ctx.createGain();
    pitchDry.gain.value = 1;
    pitchWet.gain.value = 0;
    highpass.connect(pitchDry);
    highpass.connect(jungle.input);
    jungle.output.connect(pitchWet);
    pitchDry.connect(pitchSum);
    pitchWet.connect(pitchSum);

    const mud = ctx.createBiquadFilter();
    mud.type = "peaking";
    mud.frequency.value = 300;
    mud.Q.value = 0.85;
    mud.gain.value = -4.8;
    pitchSum.connect(mud);

    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3800;
    presence.Q.value = 0.9;
    presence.gain.value = 6;
    mud.connect(presence);

    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 11000;
    air.gain.value = 2.4;
    presence.connect(air);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 6;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.14;
    air.connect(compressor);

    const makeup = ctx.createGain();
    makeup.gain.value = 1.4;
    compressor.connect(makeup);

    const satSplit = ctx.createGain();
    makeup.connect(satSplit);
    const satDry = ctx.createGain();
    const satWet = ctx.createGain();
    const satShaper = ctx.createWaveShaper();
    satShaper.curve = makeDriveCurve(0.4);
    satShaper.oversample = "2x";
    const satDrive = ctx.createGain();
    satDrive.gain.value = 1.15;
    satSplit.connect(satDry);
    satSplit.connect(satDrive);
    satDrive.connect(satShaper);
    satShaper.connect(satWet);
    const satSum = ctx.createGain();
    satDry.connect(satSum);
    satWet.connect(satSum);

    const vocDry = ctx.createGain();
    const vocWet = ctx.createGain();
    const vocSum = ctx.createGain();
    vocDry.gain.value = 1;
    vocWet.gain.value = 0;
    satSum.connect(vocDry);
    vocDry.connect(vocSum);

    const vocoderSum = ctx.createGain();
    vocoderSum.gain.value = 0.85;
    const envScalers: GainNode[] = [];
    const absCurve = makeAbsCurve();

    const carrierMix = ctx.createGain();
    const carrierOsc = ctx.createOscillator();
    carrierOsc.type = "sawtooth";
    carrierOsc.frequency.value = 140;
    const carrierOscGain = ctx.createGain();
    carrierOscGain.gain.value = 0.28;
    carrierOsc.connect(carrierOscGain);
    carrierOscGain.connect(carrierMix);

    const carrierNoise = ctx.createBufferSource();
    carrierNoise.buffer = makeNoiseBuffer(ctx);
    carrierNoise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.07;
    carrierNoise.connect(noiseGain);
    noiseGain.connect(carrierMix);

    for (const freq of VOCODER_BANDS) {
      const modBp = ctx.createBiquadFilter();
      modBp.type = "bandpass";
      modBp.frequency.value = freq;
      modBp.Q.value = 5.4;
      satSum.connect(modBp);

      const abs = ctx.createWaveShaper();
      abs.curve = absCurve;
      abs.oversample = "none";
      modBp.connect(abs);

      const env = ctx.createBiquadFilter();
      env.type = "lowpass";
      env.frequency.value = 35;
      env.Q.value = 0.7;
      abs.connect(env);

      const envScaler = ctx.createGain();
      envScaler.gain.value = 6;
      env.connect(envScaler);
      envScalers.push(envScaler);

      const carBp = ctx.createBiquadFilter();
      carBp.type = "bandpass";
      carBp.frequency.value = freq;
      carBp.Q.value = 5.4;
      carrierMix.connect(carBp);

      const bandGain = ctx.createGain();
      bandGain.gain.value = 0;
      carBp.connect(bandGain);
      envScaler.connect(bandGain.gain);
      bandGain.connect(vocoderSum);
    }

    vocoderSum.connect(vocWet);
    vocWet.connect(vocSum);

    const delayDry = ctx.createGain();
    const delayWet = ctx.createGain();
    const delaySum = ctx.createGain();
    delayDry.gain.value = 1;
    delayWet.gain.value = 0;
    vocSum.connect(delayDry);
    delayDry.connect(delaySum);

    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.312;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.28;
    vocSum.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(delaySum);

    const reverbDry = ctx.createGain();
    const reverbWet = ctx.createGain();
    const reverbSum = ctx.createGain();
    reverbDry.gain.value = 1;
    reverbWet.gain.value = 0;
    delaySum.connect(reverbDry);
    reverbDry.connect(reverbSum);

    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = makePlateImpulse(ctx);
    delaySum.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(reverbSum);

    const outputGain = ctx.createGain();
    outputGain.gain.value = 0.82;
    reverbSum.connect(outputGain);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -20;
    outputGain.connect(analyser);

    const monitorGain = ctx.createGain();
    monitorGain.gain.value = 1;
    outputGain.connect(monitorGain);
    monitorGain.connect(ctx.destination);

    const streamDest = ctx.createMediaStreamDestination();
    outputGain.connect(streamDest);

    carrierOsc.start();
    carrierNoise.start();

    return {
      ctx,
      inputGain,
      micGain,
      fileGain,
      pitchDry,
      pitchWet,
      jungle,
      mud,
      presence,
      air,
      compressor,
      makeup,
      satDry,
      satWet,
      satShaper,
      vocDry,
      vocWet,
      vocoderSum,
      carrierOsc,
      carrierOscGain,
      carrierNoise,
      delay,
      delayFeedback,
      delayWet,
      delayDry,
      convolver,
      reverbWet,
      reverbDry,
      outputGain,
      monitorGain,
      analyser,
      streamDest,
      envScalers,
    };
  }
}

"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import {
  ChevronDown,
  Headphones,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Pause,
  Play,
  Repeat,
  Square,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Visualizer } from "@/components/visualizer";
import {
  describeMicError,
  extensionForMime,
  VocalEngine,
} from "@/lib/audio/engine";
import { PRESETS, type ChainParams, type PresetId } from "@/lib/audio/presets";
import { cn } from "@/lib/utils";

const HEADPHONES_KEY = "emi-headphones-ok";

type StatusKind = "idle" | "mic" | "file" | "recording" | "saved";

function formatPitch(v: number): string {
  if (Math.abs(v) < 0.02) return "Dry";
  const st = v * 12;
  const sign = st > 0 ? "+" : "−";
  return `${sign}${Math.abs(st).toFixed(1)} st`;
}

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatHz(v: number): string {
  return `${Math.round(v)} Hz`;
}

function formatGain(v: number): string {
  return v.toFixed(2);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stampName(ext: string): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `emi-vocalization-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

export function VocalBooth() {
  const engineRef = useRef<VocalEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [params, setParams] = useState<ChainParams>(PRESETS[1]!.params);
  const [presetId, setPresetId] = useState<PresetId | "custom">("bunny");
  const [headphonesOk, setHeadphonesOk] = useState(false);
  const [fileProtocol, setFileProtocol] = useState(false);
  const [insecure, setInsecure] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [monitor, setMonitor] = useState(true);
  const [mix, setMix] = useState(false);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFlash, setStatusFlash] = useState<StatusKind | null>(null);
  const [fineOpen, setFineOpen] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const playPoll = useRef<number>(0);

  useEffect(() => {
    const engine = new VocalEngine();
    engineRef.current = engine;
    try {
      setHeadphonesOk(window.localStorage.getItem(HEADPHONES_KEY) === "1");
    } catch {
      /* ignore */
    }
    setFileProtocol(window.location.protocol === "file:");
    setInsecure(!window.isSecureContext);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    playPoll.current = window.setInterval(() => {
      const eng = engineRef.current;
      if (!eng) return;
      setPlaying(eng.isPlaying);
    }, 250);
    return () => window.clearInterval(playPoll.current);
  }, []);

  const ackHeadphones = () => {
    setHeadphonesOk(true);
    try {
      window.localStorage.setItem(HEADPHONES_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const pushParams = useCallback((next: ChainParams, fromPreset?: PresetId) => {
    setParams(next);
    if (fromPreset) setPresetId(fromPreset);
    else setPresetId("custom");
    engineRef.current?.applyParams(next);
  }, []);

  const setOne = useCallback(
    <K extends keyof ChainParams>(key: K, value: ChainParams[K]) => {
      const next = { ...params, [key]: value };
      pushParams(next);
    },
    [params, pushParams],
  );

  const applyPreset = (id: PresetId) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    pushParams({ ...preset.params }, id);
  };

  const enableMic = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    if (!headphonesOk) {
      setError("Put headphones on first so the processed voice doesn’t feed back.");
      return;
    }
    setMicBusy(true);
    try {
      await engine.enableMic();
      setAnalyser(engine.analyser);
      setMicOn(true);
    } catch (err) {
      const info = describeMicError(err);
      setError(info.message);
      setMicOn(false);
    } finally {
      setMicBusy(false);
    }
  };

  const disableMic = () => {
    engineRef.current?.disableMic();
    setMicOn(false);
  };

  const toggleMic = () => {
    if (micOn) disableMic();
    else void enableMic();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file || !engineRef.current) return;
    setError(null);
    try {
      const meta = await engineRef.current.loadFile(file);
      setFileMeta(meta);
      setAnalyser(engineRef.current.analyser);
    } catch {
      setError("Couldn’t decode that file. Try wav, mp3, m4a, or ogg.");
    }
  };

  const togglePlay = () => {
    const engine = engineRef.current;
    if (!engine || !fileMeta) return;
    if (engine.isPlaying) {
      engine.stopFile();
      setPlaying(false);
    } else {
      engine.playFile();
      setPlaying(true);
      setAnalyser(engine.analyser);
    }
  };

  const toggleRecord = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    if (recording) {
      try {
        const { blob, mime } = await engine.stopRecording();
        setRecording(false);
        if (blob.size === 0) {
          setError("The take was empty. Enable the mic or play a file, then record again.");
          return;
        }
        downloadBlob(blob, stampName(extensionForMime(mime)));
        setStatusFlash("saved");
        window.setTimeout(() => setStatusFlash(null), 3200);
      } catch (err) {
        setRecording(false);
        setError(err instanceof Error ? err.message : "Couldn’t save the take.");
      }
      return;
    }
    try {
      await engine.ensureStarted();
      setAnalyser(engine.analyser);
      engine.startRecording();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start recording.");
    }
  };

  const toggleMonitor = (on: boolean) => {
    setMonitor(on);
    engineRef.current?.setMonitor(on);
  };

  const toggleMix = (on: boolean) => {
    setMix(on);
    engineRef.current?.setMixSources(on);
  };

  const toggleLoop = () => {
    const next = !loop;
    setLoop(next);
    engineRef.current?.setLoop(next);
  };

  const status = useMemo(() => {
    if (statusFlash === "saved") return { kind: "saved" as const, label: "Saved" };
    if (recording && micOn) return { kind: "recording" as const, label: "Mic live · Recording" };
    if (recording && playing) return { kind: "recording" as const, label: "Playing file · Recording" };
    if (recording) return { kind: "recording" as const, label: "Recording" };
    if (playing) return { kind: "file" as const, label: "Playing file" };
    if (micOn) return { kind: "mic" as const, label: "Mic live" };
    return { kind: "idle" as const, label: "Idle" };
  }, [statusFlash, recording, micOn, playing]);

  const activeSignal = micOn || playing || recording;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-10 pt-6 sm:max-w-2xl sm:px-6 sm:pt-10">
      <header className="mb-6">
        <p className="mb-2 text-xs font-medium tracking-[0.22em] text-accent uppercase">
          Local vocal booth
        </p>
        <h1 className="font-headline text-4xl leading-none font-extrabold tracking-tight text-fg sm:text-5xl">
          Emi Vocalization
        </h1>
        <p className="mt-3 max-w-md text-base text-muted">
          Shape your voice. Live or uploaded.
        </p>
        <p className="mt-2 max-w-lg text-sm text-subtle">
          A vocal chain and vocoder — not AI celebrity cloning. Bunny is a style
          chain (pitch, presence, punch, delay), not a voice replica.
        </p>
      </header>

      <section className="rounded-xl bg-surface p-4 shadow-card">
        <Visualizer analyser={analyser} active={activeSignal} />
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-sm"
        >
          <span
            className={cn(
              "size-2.5 rounded-full",
              status.kind === "idle" && "bg-subtle",
              status.kind === "mic" && "bg-primary",
              status.kind === "file" && "bg-lilac",
              status.kind === "recording" && "bg-primary",
              status.kind === "saved" && "bg-accent",
            )}
          />
          <span className="font-medium tabular-nums text-fg">{status.label}</span>
        </div>
      </section>

      {fileProtocol ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm text-lilac shadow-card">
          This page was opened as a file. Serve it over localhost or host it on
          https so microphone permissions can work.
        </p>
      ) : null}

      {insecure && !fileProtocol ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm text-lilac shadow-card">
          Microphone access needs a secure page (https) or localhost.
        </p>
      ) : null}

      {!headphonesOk ? (
        <div className="mt-4 rounded-xl bg-surface p-4 shadow-card">
          <div className="flex items-start gap-3">
            <Headphones className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg">Headphones first</p>
              <p className="mt-1 text-sm text-muted">
                The processed voice plays through speakers. Wear headphones
                before enabling the mic or you will get feedback.
              </p>
              <Button className="mt-3" variant="gold" onClick={ackHeadphones}>
                I have headphones
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg bg-plum px-4 py-3 text-sm text-fg shadow-card" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-xl bg-surface p-4 shadow-card">
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="col-span-2"
            variant={micOn ? "default" : "outline"}
            size="lg"
            onClick={toggleMic}
            disabled={micBusy}
            aria-pressed={micOn}
          >
            {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            {micOn ? "Mic live — tap to stop" : "Enable mic"}
          </Button>
          <Button
            variant={recording ? "default" : "outline"}
            size="lg"
            onClick={() => void toggleRecord()}
            aria-pressed={recording}
          >
            {recording ? <Square className="size-4" /> : <span className="size-3 rounded-full bg-primary" />}
            {recording ? "Stop & save" : "Record"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            Upload
          </Button>
          <Button
            variant={playing ? "subtle" : "outline"}
            size="lg"
            onClick={togglePlay}
            disabled={!fileMeta}
            aria-pressed={playing}
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="ml-0.5 size-4" />
            )}
            {playing ? "Stop" : "Play"}
          </Button>
          <Button
            variant={loop ? "subtle" : "outline"}
            size="lg"
            onClick={toggleLoop}
            aria-pressed={loop}
          >
            <Repeat className="size-4" />
            Loop {loop ? "on" : "off"}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm,.mp3,.wav,.m4a,.ogg,.aac"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            void onPickFile(file);
            e.target.value = "";
          }}
        />
        {fileMeta ? (
          <p className="mt-3 truncate text-sm text-muted">
            {fileMeta.name}
            <span className="tabular-nums text-subtle"> · {formatTime(fileMeta.duration)}</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-subtle">mp3, wav, m4a, ogg — same chain as the mic.</p>
        )}
      </section>

      <section className="mt-4">
        <p className="mb-2 text-xs font-medium tracking-[0.18em] text-subtle uppercase">
          Presets
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const selected = presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  "min-h-11 rounded-full px-4 text-sm font-medium shadow-card transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.96]",
                  selected && preset.featured && "bg-accent text-accent-fg",
                  selected && !preset.featured && "bg-primary text-primary-fg",
                  !selected && "bg-surface text-fg hover:shadow-card-hover",
                )}
                aria-pressed={selected}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-subtle">
          {presetId === "custom"
            ? "Custom chain"
            : PRESETS.find((p) => p.id === presetId)?.blurb}
        </p>
      </section>

      <section className="mt-4 rounded-xl bg-surface p-4 shadow-card">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-11 items-center justify-between gap-3 sm:justify-start">
            <span className="flex items-center gap-2 text-sm font-medium">
              {monitor ? <Monitor className="size-4 text-lilac" /> : <MonitorOff className="size-4 text-subtle" />}
              Monitor
            </span>
            <Switch checked={monitor} onCheckedChange={toggleMonitor} aria-label="Monitor" />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 sm:justify-start">
            <span className="text-sm font-medium">Mix mic + file</span>
            <Switch checked={mix} onCheckedChange={toggleMix} aria-label="Mix mic and file" />
          </label>
        </div>
        <ParamSlider
          label="Input"
          value={params.input}
          min={0}
          max={1.4}
          step={0.01}
          display={formatGain(params.input)}
          onValue={setOne}
          name="input"
        />
        <ParamSlider
          label="Pitch"
          value={params.pitch}
          min={-1}
          max={1}
          step={0.01}
          display={formatPitch(params.pitch)}
          onValue={setOne}
          name="pitch"
        />
        <ParamSlider
          label="Vocoder mix"
          value={params.vocoderMix}
          min={0}
          max={1}
          step={0.01}
          display={formatPct(params.vocoderMix)}
          onValue={setOne}
          name="vocoderMix"
        />
        <ParamSlider
          label="Output"
          value={params.output}
          min={0}
          max={1.2}
          step={0.01}
          display={formatGain(params.output)}
          onValue={setOne}
          name="output"
        />
      </section>

      <Collapsible.Root open={fineOpen} onOpenChange={setFineOpen} className="mt-4">
        <section className="rounded-xl bg-surface p-4 shadow-card">
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-sm font-medium text-muted">Fine controls</span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  fineOpen && "rotate-180",
                )}
              />
            </button>
          </Collapsible.Trigger>
          <Collapsible.Content className="data-[state=closed]:hidden">
            <ParamSlider
              label="Carrier tone"
              value={params.carrierHz}
              min={80}
              max={400}
              step={1}
              display={formatHz(params.carrierHz)}
              onValue={setOne}
              name="carrierHz"
            />
            <ParamSlider
              label="Saturation"
              value={params.saturation}
              min={0}
              max={1}
              step={0.01}
              display={formatPct(params.saturation)}
              onValue={setOne}
              name="saturation"
            />
            <ParamSlider
              label="Compression"
              value={params.compression}
              min={0}
              max={1}
              step={0.01}
              display={formatPct(params.compression)}
              onValue={setOne}
              name="compression"
            />
            <ParamSlider
              label="Delay"
              value={params.delay}
              min={0}
              max={1}
              step={0.01}
              display={formatPct(params.delay)}
              onValue={setOne}
              name="delay"
            />
            <ParamSlider
              label="Reverb"
              value={params.reverb}
              min={0}
              max={1}
              step={0.01}
              display={formatPct(params.reverb)}
              onValue={setOne}
              name="reverb"
            />
            <ParamSlider
              label="Presence"
              value={params.presence}
              min={0}
              max={1}
              step={0.01}
              display={formatPct(params.presence)}
              onValue={setOne}
              name="presence"
            />
          </Collapsible.Content>
        </section>
      </Collapsible.Root>

      <Collapsible.Root open={spacesOpen} onOpenChange={setSpacesOpen} className="mt-4">
        <section className="rounded-xl bg-surface p-4 shadow-card">
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-sm font-medium text-muted">Use with X Spaces</span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  spacesOpen && "rotate-180",
                )}
              />
            </button>
          </Collapsible.Trigger>
          <Collapsible.Content className="data-[state=closed]:hidden">
            <div className="space-y-3 pt-1 text-sm leading-relaxed text-muted">
              <p>
                The phone X app cannot take this page as the microphone. Use Emi
                Vocalization to rehearse, or record a processed clip and play it
                back.
              </p>
              <p>
                On desktop: run a virtual audio cable (VB-Cable on Windows,
                BlackHole on Mac), route this browser’s output into the cable,
                then select that cable as the X microphone. Keep Monitor on so
                the cable hears the chain. Headphones are required.
              </p>
              <p>
                Desktop tab-to-mic mixers exist. The mobile X app has no
                equivalent — there is no way to inject this page into a Space
                from a phone.
              </p>
            </div>
          </Collapsible.Content>
        </section>
      </Collapsible.Root>

      <footer className="mt-8 space-y-2 text-xs leading-relaxed text-subtle">
        <p>Emi Vocalization — local vocal processor. Your audio never leaves this device.</p>
        <p>
          Pitch shifter: Jungle by Chris Wilson / Google Inc. (BSD). Analog-style
          filter-bank vocoder, 8 bands.
        </p>
      </footer>
    </main>
  );
}

function ParamSlider<K extends keyof ChainParams>({
  label,
  value,
  min,
  max,
  step,
  display,
  onValue,
  name,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  name: K;
  onValue: (key: K, value: ChainParams[K]) => void;
}) {
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium text-fg" htmlFor={`sl-${name}`}>
          {label}
        </label>
        <span className="text-xs font-medium tabular-nums text-lilac">{display}</span>
      </div>
      <Slider
        id={`sl-${name}`}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(vals) => onValue(name, (vals[0] ?? value) as ChainParams[K])}
        aria-label={label}
      />
    </div>
  );
}

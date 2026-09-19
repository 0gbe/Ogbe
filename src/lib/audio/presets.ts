export type ChainParams = {
  input: number;
  pitch: number;
  vocoderMix: number;
  carrierHz: number;
  saturation: number;
  compression: number;
  delay: number;
  reverb: number;
  presence: number;
  output: number;
};

export type PresetId = "dry" | "bunny" | "vocoder" | "robot" | "deep" | "spaces";

export type Preset = {
  id: PresetId;
  name: string;
  blurb: string;
  featured?: boolean;
  params: ChainParams;
};

export const DEFAULT_PARAMS: ChainParams = {
  input: 0.85,
  pitch: -0.18,
  vocoderMix: 0.08,
  carrierHz: 132,
  saturation: 0.46,
  compression: 0.72,
  delay: 0.42,
  reverb: 0.24,
  presence: 0.78,
  output: 0.82,
};

export const PRESETS: Preset[] = [
  {
    id: "dry",
    name: "Dry",
    blurb: "Clean pass-through. Use this to hear the raw take.",
    params: {
      input: 0.85,
      pitch: 0,
      vocoderMix: 0,
      carrierHz: 140,
      saturation: 0,
      compression: 0.12,
      delay: 0,
      reverb: 0,
      presence: 0.38,
      output: 0.85,
    },
  },
  {
    id: "bunny",
    name: "Bunny",
    blurb: "Style chain — slight pitch down, punch, presence, rhythmic delay. Not a voice replica.",
    featured: true,
    params: { ...DEFAULT_PARAMS },
  },
  {
    id: "vocoder",
    name: "Vocoder",
    blurb: "Classic analog-style filter bank on a saw carrier.",
    params: {
      input: 0.88,
      pitch: 0,
      vocoderMix: 0.86,
      carrierHz: 148,
      saturation: 0.22,
      compression: 0.55,
      delay: 0.18,
      reverb: 0.22,
      presence: 0.62,
      output: 0.8,
    },
  },
  {
    id: "robot",
    name: "Robot",
    blurb: "Bright carrier, pitch up, heavy vocoder grit.",
    params: {
      input: 0.86,
      pitch: 0.32,
      vocoderMix: 0.74,
      carrierHz: 220,
      saturation: 0.34,
      compression: 0.6,
      delay: 0.12,
      reverb: 0.16,
      presence: 0.7,
      output: 0.8,
    },
  },
  {
    id: "deep",
    name: "Deep",
    blurb: "Down-shifted booth voice with dark body.",
    params: {
      input: 0.9,
      pitch: -0.52,
      vocoderMix: 0.16,
      carrierHz: 98,
      saturation: 0.5,
      compression: 0.64,
      delay: 0.22,
      reverb: 0.28,
      presence: 0.32,
      output: 0.84,
    },
  },
  {
    id: "spaces",
    name: "Spaces Tight",
    blurb: "Short room, punchy compression — built for compressed live rooms.",
    params: {
      input: 0.86,
      pitch: -0.08,
      vocoderMix: 0,
      carrierHz: 140,
      saturation: 0.26,
      compression: 0.8,
      delay: 0.12,
      reverb: 0.16,
      presence: 0.66,
      output: 0.84,
    },
  },
];

export function getPreset(id: PresetId): Preset {
  const found = PRESETS.find((p) => p.id === id);
  return found ?? PRESETS[1]!;
}

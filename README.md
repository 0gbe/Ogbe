# Emi Vocalization

Local vocal processor and vocoder by Ogbe. Shape your voice live or from an uploaded file. All audio stays in the browser — nothing is uploaded to a server.

**Shape your voice. Live or uploaded.**

This is a vocal chain + vocoder, not AI celebrity cloning. **Bunny** is a style preset (pitch, presence, punch, delay) — not a voice replica.

## Features

- Live mic processing (headphones required)
- Upload mp3 / wav / m4a / ogg through the same chain
- Record processed output and download the take
- Presets: Dry, Bunny, Vocoder, Robot, Deep, Spaces Tight
- Analog-style 8-band vocoder, Jungle pitch shifter, EQ, compression, saturation, delay, plate reverb

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints, wear headphones, tap **Enable mic**, then **Bunny**, and speak.

Mic access needs https or localhost. The page will not get microphone permission if opened as a file.

## Stack

TanStack Start, React, Tailwind, Web Audio API. Pitch shifter: Jungle by Chris Wilson / Google Inc. (BSD).

/*
 * Copyright 2012, Google Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Jungle delay-based pitch shifter by Chris Wilson (Google).
 * https://github.com/cwilso/Audio-Input-Effects
 */

const DELAY_TIME = 0.1;
const FADE_TIME = 0.05;
const BUFFER_TIME = 0.1;

function createFadeBuffer(
  context: AudioContext,
  activeTime: number,
  fadeTime: number,
): AudioBuffer {
  const length1 = Math.max(1, Math.floor(activeTime * context.sampleRate));
  const length2 = Math.max(0, Math.floor((activeTime - 2 * fadeTime) * context.sampleRate));
  const length = Math.max(1, length1 + length2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = Math.max(1, fadeTime * context.sampleRate);
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;

  for (let i = 0; i < length1; ++i) {
    let value: number;
    if (i < fadeIndex1) {
      value = Math.sqrt(i / fadeLength);
    } else if (i >= fadeIndex2) {
      value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    } else {
      value = 1;
    }
    p[i] = value;
  }
  for (let i = length1; i < length; ++i) {
    p[i] = 0;
  }
  return buffer;
}

function createDelayTimeBuffer(
  context: AudioContext,
  activeTime: number,
  fadeTime: number,
  shiftUp: boolean,
): AudioBuffer {
  const length1 = Math.max(1, Math.floor(activeTime * context.sampleRate));
  const length2 = Math.max(0, Math.floor((activeTime - 2 * fadeTime) * context.sampleRate));
  const length = Math.max(1, length1 + length2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);

  for (let i = 0; i < length1; ++i) {
    if (shiftUp) {
      p[i] = (length1 - i) / length;
    } else {
      p[i] = i / length1;
    }
  }
  for (let i = length1; i < length; ++i) {
    p[i] = 0;
  }
  return buffer;
}

/** Chris Wilson / Google "Jungle" dual-delay pitch shifter. */
export class Jungle {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly mod1Gain: GainNode;
  private readonly mod2Gain: GainNode;
  private readonly mod3Gain: GainNode;
  private readonly mod4Gain: GainNode;
  private readonly modGain1: GainNode;
  private readonly modGain2: GainNode;

  constructor(context: AudioContext) {
    const input = context.createGain();
    const output = context.createGain();
    this.input = input;
    this.output = output;

    const mod1 = context.createBufferSource();
    const mod2 = context.createBufferSource();
    const mod3 = context.createBufferSource();
    const mod4 = context.createBufferSource();
    const shiftDownBuffer = createDelayTimeBuffer(context, BUFFER_TIME, FADE_TIME, false);
    const shiftUpBuffer = createDelayTimeBuffer(context, BUFFER_TIME, FADE_TIME, true);
    mod1.buffer = shiftDownBuffer;
    mod2.buffer = shiftDownBuffer;
    mod3.buffer = shiftUpBuffer;
    mod4.buffer = shiftUpBuffer;
    mod1.loop = true;
    mod2.loop = true;
    mod3.loop = true;
    mod4.loop = true;

    const mod1Gain = context.createGain();
    const mod2Gain = context.createGain();
    const mod3Gain = context.createGain();
    mod3Gain.gain.value = 0;
    const mod4Gain = context.createGain();
    mod4Gain.gain.value = 0;

    mod1.connect(mod1Gain);
    mod2.connect(mod2Gain);
    mod3.connect(mod3Gain);
    mod4.connect(mod4Gain);

    const modGain1 = context.createGain();
    const modGain2 = context.createGain();
    const delay1 = context.createDelay(1);
    const delay2 = context.createDelay(1);
    mod1Gain.connect(modGain1);
    mod2Gain.connect(modGain2);
    mod3Gain.connect(modGain1);
    mod4Gain.connect(modGain2);
    modGain1.connect(delay1.delayTime);
    modGain2.connect(delay2.delayTime);

    const fade1 = context.createBufferSource();
    const fade2 = context.createBufferSource();
    const fadeBuffer = createFadeBuffer(context, BUFFER_TIME, FADE_TIME);
    fade1.buffer = fadeBuffer;
    fade2.buffer = fadeBuffer;
    fade1.loop = true;
    fade2.loop = true;

    const mix1 = context.createGain();
    const mix2 = context.createGain();
    mix1.gain.value = 0;
    mix2.gain.value = 0;
    fade1.connect(mix1.gain);
    fade2.connect(mix2.gain);

    input.connect(delay1);
    input.connect(delay2);
    delay1.connect(mix1);
    delay2.connect(mix2);
    mix1.connect(output);
    mix2.connect(output);

    const t = context.currentTime + 0.05;
    const t2 = t + BUFFER_TIME - FADE_TIME;
    mod1.start(t);
    mod2.start(t2);
    mod3.start(t);
    mod4.start(t2);
    fade1.start(t);
    fade2.start(t2);

    this.mod1Gain = mod1Gain;
    this.mod2Gain = mod2Gain;
    this.mod3Gain = mod3Gain;
    this.mod4Gain = mod4Gain;
    this.modGain1 = modGain1;
    this.modGain2 = modGain2;

    this.setDelay(DELAY_TIME);
  }

  setDelay(delayTime: number) {
    this.modGain1.gain.setTargetAtTime(0.5 * delayTime, 0, 0.01);
    this.modGain2.gain.setTargetAtTime(0.5 * delayTime, 0, 0.01);
  }

  /** Offset in octaves-ish: -1 down, +1 up. 0 is still internally shifting unless bypassed. */
  setPitchOffset(mult: number) {
    if (mult > 0) {
      this.mod1Gain.gain.value = 0;
      this.mod2Gain.gain.value = 0;
      this.mod3Gain.gain.value = 1;
      this.mod4Gain.gain.value = 1;
    } else {
      this.mod1Gain.gain.value = 1;
      this.mod2Gain.gain.value = 1;
      this.mod3Gain.gain.value = 0;
      this.mod4Gain.gain.value = 0;
    }
    this.setDelay(DELAY_TIME * Math.abs(mult));
  }
}

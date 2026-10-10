export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error("sample rates must be positive");
  }
  if (fromRate === toRate) {
    return input;
  }
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = index * ratio;
    const left = Math.floor(source);
    const fraction = source - left;
    const a = input[left] ?? 0;
    const b = input[left + 1] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

export function floatToInt16Le(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

export function uplinkMicFrame(frame: ArrayBuffer, muted: boolean): ArrayBuffer {
  if (!muted) {
    return frame;
  }
  return new ArrayBuffer(frame.byteLength);
}

export function int16LeToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const samples = Math.floor(bytes.byteLength / 2);
  const output = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const sample = view.getInt16(index * 2, true);
    output[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return output;
}

export class SampleAccumulator {
  private pending = new Float32Array(0);

  constructor(private readonly frameSamples: number) {
    if (frameSamples <= 0) {
      throw new Error("frame sample count must be positive");
    }
  }

  push(chunk: Float32Array): Float32Array[] {
    const merged = new Float32Array(this.pending.length + chunk.length);
    merged.set(this.pending);
    merged.set(chunk, this.pending.length);
    const frames: Float32Array[] = [];
    let offset = 0;
    while (offset + this.frameSamples <= merged.length) {
      frames.push(merged.slice(offset, offset + this.frameSamples));
      offset += this.frameSamples;
    }
    this.pending = merged.slice(offset);
    return frames;
  }

  reset(): void {
    this.pending = new Float32Array(0);
  }
}

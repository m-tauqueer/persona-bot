/** Wrap raw little-endian PCM in a RIFF header so the stored blob plays. */
export function wavFromPcm(
  pcm: Buffer,
  options: { sampleRate: number; channels: number; bitsPerSample: number },
): Buffer {
  const { sampleRate, channels, bitsPerSample } = options;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function pcmDurationMs(
  byteLength: number,
  options: { sampleRate: number; channels: number; bitsPerSample: number },
): number {
  const bytesPerSecond =
    options.sampleRate * options.channels * (options.bitsPerSample / 8);
  if (bytesPerSecond <= 0) {
    return 0;
  }
  return Math.round((byteLength / bytesPerSecond) * 1000);
}

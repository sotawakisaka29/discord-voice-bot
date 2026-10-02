import test from "node:test";
import assert from "node:assert/strict";
import { encodeMonoPcm16Wav, resampleLinear } from "../public/wav.js";

test("resampling changes the sample count", () => {
  const source = new Float32Array([0, 0.5, 1, 0.5]);
  assert.equal(resampleLinear(source, 4, 2).length, 2);
});

test("WAV encoder writes a valid mono PCM header", async () => {
  const blob = encodeMonoPcm16Wav(new Float32Array([0, 0.5, -0.5]), 44_100);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, 50);
});

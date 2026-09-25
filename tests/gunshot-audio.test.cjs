const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const calls = { fetch: 0, decode: 0, sources: 0 };
const sandbox = {
  window: { addEventListener() {} },
  fetch: async () => {
    calls.fetch++;
    return { arrayBuffer: async () => new ArrayBuffer(8) };
  }
};
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'js/audio.js'), 'utf8')}\nglobalThis.AudioManagerUnderTest = AudioManager;`, sandbox);
const AudioManager = sandbox.AudioManagerUnderTest;

function makeAudioContext() {
  return {
    currentTime: 0,
    decodeAudioData: async buffer => { calls.decode++; return { buffer }; },
    createBufferSource() {
      calls.sources++;
      return { connect() {}, start() {}, stop() {} };
    },
    createGain() { return { gain: { value: 1 }, connect() {} }; },
    createStereoPanner() { return { pan: { value: 0 }, connect() {} }; }
  };
}

test('preloaded gunshot audio decodes once and reuses the decoded buffer for every shot', async () => {
  const audio = new AudioManager();
  audio.context = makeAudioContext();
  audio.master = { connect() {} };
  audio.missionAudioMuted = false;
  const url = 'resources/gun-shot-359196.mp3';

  await audio.preloadSound(url);
  await audio.playSound(url, 0.3);
  await audio.playSound(url, 0.3);

  assert.deepEqual(calls, { fetch: 1, decode: 1, sources: 2 });
});

test('spatial gunshot audio pans by source direction and attenuates behind walls', async () => {
  const audio = new AudioManager();
  audio.context = makeAudioContext();
  audio.master = { connect() {} };
  audio.hasStereoPanner = true;
  audio.missionAudioMuted = false;
  let panner;
  audio.context.createStereoPanner = () => (panner = { pan: { value: 0 }, connect() {} });
  await audio.preloadSound('resources/gun-shot-359196.mp3');
  const listener = { x: 0, y: 0, angle: 0 };
  const source = { x: 0, y: 200 };
  const clearMap = { rayVisionDistance: (_x, _y, _dx, _dy, max) => max };

  await audio.playSpatialSound('resources/gun-shot-359196.mp3', 0.5, listener, source, clearMap);
  assert.ok(panner.pan.value > 0.9);
  const clearGain = audio.lastSpatialGain;
  const blockedMap = { rayVisionDistance: () => 20 };
  await audio.playSpatialSound('resources/gun-shot-359196.mp3', 0.5, listener, source, blockedMap);
  assert.ok(audio.lastSpatialGain < clearGain);
});

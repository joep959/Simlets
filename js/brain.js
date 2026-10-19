'use strict';
// Hybrid brain: a small neural network whose outputs are ADDED to the rule-based action scores.
// Output weights start at zero, so a new brain changes nothing; evolution grows corrections that
// can eventually override the rules. Brain weights are a second chromosome, separate from the trait genes
// (species similarity keeps using trait genes only).

const BRAIN_IN = ['energy', 'hunger', 'stamina', 'exhausted', 'threat', 'threatNear', 'prey', 'preyNear',
                  'preySize', 'food', 'foodNear', 'night', 'bust', 'kin', 'ready', 'age',
                  'inForest', 'onWater', 'freshSoil', 'scent', 'shelterNear', 'storeFull', 'buildSite', 'timeToBust', 'timeToBoom',
                  'fire', 'flood', 'bias'];
const BRAIN_OUT = ['flee', 'hunt', 'eat', 'recall', 'breed', 'clone', 'farm', 'rest', 'wander', 'track', 'build', 'shelter', 'draw', 'escape'];
// The layout before hazard sensing (saves without brainIn/brainOut use it): 26 inputs, 13 outputs
const BRAIN_IN_V4 = BRAIN_IN.filter(k => k !== 'fire' && k !== 'flood');
const BRAIN_OUT_V4 = BRAIN_OUT.filter(k => k !== 'escape');
const NI = BRAIN_IN.length, NH = 8, NO = BRAIN_OUT.length;
const W1_LEN = NI * NH;                       // input -> hidden (the 'bias' input acts as hidden bias)
const BRAIN_LEN = W1_LEN + (NH + 1) * NO;     // hidden -> output, plus one output bias row

const Brain = { mode: 'hybrid' };              // 'rules' = brains ignored and frozen; 'hybrid' = brains steer and evolve

function newBrain() {
  const b = new Float32Array(BRAIN_LEN);
  for (let i = 0; i < W1_LEN; i++) b[i] = gauss() * 0.5;   // random feature detectors...
  return b;                                                // ...but zero output weights: no effect yet
}

function mutateBrain(src, rate, size) {
  const b = new Float32Array(src);
  for (let i = 0; i < BRAIN_LEN; i++) if (Math.random() < rate) b[i] += gauss() * size;
  return b;
}

// Crossover by whole hidden neuron: each neuron (its input weights AND its output weights) comes from one
// parent, so a working feature detector isn't spliced into nonsense.
function crossBrains(a, b) {
  const c = new Float32Array(BRAIN_LEN);
  for (let h = 0; h < NH; h++) {
    const p = Math.random() < 0.5 ? a : b;
    for (let i = 0; i < NI; i++) c[i * NH + h] = p[i * NH + h];
    for (let o = 0; o < NO; o++) c[W1_LEN + h * NO + o] = p[W1_LEN + h * NO + o];
  }
  const p = Math.random() < 0.5 ? a : b;
  for (let o = 0; o < NO; o++) c[W1_LEN + NH * NO + o] = p[W1_LEN + NH * NO + o];
  return c;
}

const _hid = new Float32Array(NH);
function runBrain(b, x, out) {
  for (let h = 0; h < NH; h++) {
    let sum = 0;
    for (let i = 0; i < NI; i++) sum += x[i] * b[i * NH + h];
    _hid[h] = Math.tanh(sum);                 // the non-linearity: lets inputs interact
  }
  for (let o = 0; o < NO; o++) {
    let sum = b[W1_LEN + NH * NO + o];
    for (let h = 0; h < NH; h++) sum += _hid[h] * b[W1_LEN + h * NO + o];
    out[o] = sum;
  }
}

// Convert a brain saved with another layout (inputs inNames, outputs outNames) to the current one, matching
// weights by input and output NAME. Inputs or outputs the old brain lacked get zero weights, so a converted
// brain behaves exactly as it did (a new input has no effect until mutation grows its weights). Returns null if the
// weights don't fit the stated layout.
function remapBrain(old, inNames, outNames) {
  const oi = inNames.length, oo = outNames.length;
  if (!old || old.length !== oi * NH + (NH + 1) * oo) return null;
  const b = new Float32Array(BRAIN_LEN);
  for (let i = 0; i < NI; i++) {
    const j = inNames.indexOf(BRAIN_IN[i]); if (j < 0) continue;
    for (let h = 0; h < NH; h++) b[i * NH + h] = old[j * NH + h];
  }
  for (let o = 0; o < NO; o++) {
    const j = outNames.indexOf(BRAIN_OUT[o]); if (j < 0) continue;
    for (let h = 0; h <= NH; h++) b[W1_LEN + h * NO + o] = old[oi * NH + h * oo + j];   // h = NH: output bias row
  }
  return b;
}

// Rough "which input pushes which action" map: W1·W2 (ignores the tanh), for the inspector heat-map
function brainInfluence(b) {
  const m = [];
  for (let i = 0; i < NI; i++) {
    const row = new Float32Array(NO);
    for (let o = 0; o < NO; o++) { let s = 0; for (let h = 0; h < NH; h++) s += b[i * NH + h] * b[W1_LEN + h * NO + o]; row[o] = s; }
    m.push(row);
  }
  return m;
}

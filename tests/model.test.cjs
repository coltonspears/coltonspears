"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, webcrypto } = require("node:crypto");
const vm = require("node:vm");

const rules = require("../site/arena.js");
globalThis.UTT = rules;
const UTTModel = require("../site/model.js");
const bytes = fs.readFileSync(path.join(__dirname, "../site/models/generation-168.bin"));
const fixtures = require("./fixtures/model-parity.json");
const toBuffer = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const loaded = UTTModel.fromBuffer(toBuffer(bytes));

function close(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), label + " must be finite");
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} differs from PyTorch ${expected} by ${Math.abs(actual - expected)}`);
}

function resigned(mutator) {
  const result = Buffer.from(bytes);
  mutator(result);
  createHash("sha256").update(result.subarray(0, -32)).digest().copy(result, result.length - 32);
  return toBuffer(result);
}

test("loads authentic generation-168 weights and verifies recorded provenance", async () => {
  const model = await loaded;
  assert.equal(createHash("sha256").update(bytes).digest("hex"), UTTModel.FILE_SHA256);
  assert.equal(UTTModel.FILE_SHA256, fixtures.file_sha256);
  assert.equal(model.checksum, fixtures.payload_sha256);
  assert.equal(model.checksum, UTTModel.PAYLOAD_SHA256);
  assert.equal(model.architecture.parameter_count, 132266);
  assert.equal(model.architecture.fp32_bytes, 529064);
  assert.equal(bytes.length, 530049);
});

for (const fixture of fixtures.cases) {
  test(`original PyTorch inference and PUCT64 parity: ${fixture.name}`, async () => {
    const model = await loaded;
    const state = structuredClone(fixture.state);
    const original = structuredClone(state);
    assert.deepEqual(rules.legal(state), fixture.legal);
    const evaluation = model.evaluate(state);
    assert.equal(evaluation.policy.length, 81);
    for (let action = 0; action < 81; action++) {
      close(evaluation.policy[action], fixture.evaluation.policy[action], 0.000004, `policy ${action}`);
      if (!fixture.legal.includes(action)) assert.equal(evaluation.policy[action], 0);
      if (fixture.evaluation.logits) close(evaluation.logits[action], fixture.evaluation.logits[action], 0.00002, `logit ${action}`);
    }
    close(evaluation.value, fixture.evaluation.value, 0.000004, "current-player value");
    close(evaluation.policy.reduce((a, b) => a + b, 0), state.winner ? 0 : 1, 1e-12, "normalized policy");
    const result = model.search(state);
    assert.equal(result.action, fixture.search.action);
    assert.deepEqual(result.visits, fixture.search.visits);
    assert.equal(result.simulations, fixture.search.simulations);
    assert.equal(result.visits.reduce((a, b) => a + b, 0), result.simulations);
    close(result.value, fixture.search.value, 0.000004, "search root value");
    for (let action = 0; action < 81; action++) {
      close(result.policy[action], result.simulations ? result.visits[action] / result.simulations : 0, 1e-12, "search visit policy");
      if (!fixture.legal.includes(action)) assert.equal(result.visits[action], 0);
    }
    assert.deepEqual(state, original, "inference/search must not mutate caller state");
  });
}

test("search is deterministic and flips terminal values to the root player's perspective", async () => {
  const model = await loaded;
  const state = fixtures.cases.find(row => row.name === "immediate-macro-win").state;
  const first = model.search(state);
  assert.equal(first.action, 20);
  assert.ok(first.value > 0.9, "winning continuation must be positive for the player moving");
  assert.deepEqual(model.search(state), first);
  const terminal = rules.play(state, first.action);
  assert.equal(model.evaluate(terminal).value, -1, "losing next player must receive -1");
});

test("zero search budget and terminal states never invent an action", async () => {
  const model = await loaded;
  const result = model.search(rules.create(), 0);
  assert.equal(result.action, null);
  assert.equal(result.value, null);
  assert.equal(result.simulations, 0);
  assert.deepEqual(result.visits, Array(81).fill(0));
  for (const fixture of fixtures.cases.filter(row => row.state.winner)) {
    assert.equal(model.search(fixture.state, 0).value, fixture.evaluation.value);
    assert.equal(model.search(fixture.state).action, null);
  }
});

test("closed forced destinations become free choice, including their feature plane", async () => {
  const model = await loaded;
  const free = fixtures.cases.find(row => row.name === "closed-destination-free-choice").state;
  assert.deepEqual(model.evaluate({ ...free, next: 2 }), model.evaluate(free));
});

test("malformed states and invalid simulation budgets are rejected", async () => {
  const model = await loaded;
  assert.throws(() => model.evaluate({}), /Invalid/);
  assert.throws(() => model.evaluate({ ...rules.create(), current: 0 }), /Invalid/);
  assert.throws(() => model.evaluate({ ...rules.create(), next: 9 }), /Invalid/);
  for (const count of [-1, 0.5, NaN, Infinity, 4097]) {
    assert.throws(() => model.search(rules.create(), count), /Simulation count/);
  }
});

test("rejects truncation and corruption before using any model data", async () => {
  await assert.rejects(UTTModel.fromBuffer(new ArrayBuffer(30)), /too short/);
  await assert.rejects(UTTModel.fromBuffer(bytes), /ArrayBuffer/);
  const corrupt = Buffer.from(bytes);
  corrupt[2000] ^= 1;
  await assert.rejects(UTTModel.fromBuffer(toBuffer(corrupt)), /SHA-256 checksum/);
  await assert.rejects(UTTModel.fromBuffer(toBuffer(bytes.subarray(0, -1))), /SHA-256 checksum/);
});

test("valid checksums do not bypass format, tensor, or finite-weight validation", async () => {
  const tensorStart = 28 + bytes.readUInt32LE(12);
  const nameLength = bytes.readUInt16LE(tensorStart);
  const firstDimension = tensorStart + 12 + nameLength;
  const firstWeight = firstDimension + 8;
  const cases = [
    [b => { b[0] = 0; }, /magic/],
    [b => b.writeUInt32LE(2, 8), /schema/],
    [b => b.writeUInt32LE(100, 12), /architecture size/],
    [b => b.writeUInt32LE(15, 16), /tensor count/],
    [b => b.writeUInt32LE(0, 20), /weight byte count/],
    [b => { b[40] ^= 1; }, /architecture/],
    [b => { b[tensorStart + 3] = 1; }, /reserved flags/],
    [b => { b[tensorStart + 12] = 120; }, /name\/order/],
    [b => { b[tensorStart + 2] = 1; }, /rank/],
    [b => b.writeUInt32LE(3, firstDimension), /shape/],
    [b => b.writeUInt32LE(1, tensorStart + 4), /element count/],
    [b => b.writeFloatLE(Infinity, firstWeight), /non-finite/],
  ];
  for (const [mutator, pattern] of cases) await assert.rejects(UTTModel.fromBuffer(resigned(mutator)), pattern);
  const payload = Buffer.concat([bytes.subarray(0, -32), Buffer.from([0])]);
  const trailing = Buffer.concat([payload, createHash("sha256").update(payload).digest()]);
  await assert.rejects(UTTModel.fromBuffer(toBuffer(trailing)), /trailing payload/);
});

test("works as a plain global script in a worker-like context without module/require", async () => {
  const context = vm.createContext({ crypto: webcrypto, TextDecoder, ArrayBuffer, Uint8Array, Float32Array, DataView, UTT: rules });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../site/model.js"), "utf8"), context);
  const browserModel = await context.UTTModel.fromBuffer(toBuffer(bytes));
  close(browserModel.evaluate(rules.create()).value, fixtures.cases[0].evaluation.value, 0.000004, "worker inference");
});

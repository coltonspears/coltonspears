'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const UTT = require('../site/arena.js');
const replay = require('../assets/replay.json');

test('a move routes to the matching board without mutating the previous position', () => {
  const initial = UTT.create();
  assert.equal(UTT.legal(initial).length, 81);
  const next = UTT.play(initial, 40);
  assert.equal(next.next, 4);
  assert.equal(next.current, -1);
  assert.equal(initial.cells[40], 0);
  assert.equal(UTT.legal(next).length, 8);
  assert.ok(UTT.legal(next).every(action => Math.floor(action / 9) === 4));
  for (const action of [0, 40, 40.5, -1, 81]) {
    assert.throws(() => UTT.play(next, action), RangeError);
  }
});

test('won or drawn destination boards allow a choice among all open boards', () => {
  for (const result of [1, -1, 2]) {
    const state = UTT.create();
    state.won[2] = result;
    const next = UTT.play(state, 2);
    assert.equal(next.next, -1);
    assert.equal(UTT.legal(next).length, 71);
    assert.ok(UTT.legal(next).every(action => Math.floor(action / 9) !== 2));
  }
});

test('capturing the third board wins the match and closes all moves', () => {
  const state = UTT.create();
  state.won[0] = state.won[1] = 1;
  state.cells[18] = state.cells[19] = 1;
  state.next = 2;
  const next = UTT.play(state, 20);
  assert.equal(next.won[2], 1);
  assert.equal(next.winner, 1);
  assert.deepEqual(UTT.legal(next), []);
  assert.throws(() => UTT.play(next, 21), RangeError);
});

test('drawn local boards never count as a winning macro line', () => {
  const state = UTT.create();
  state.won.fill(2);
  state.won[8] = 0;
  state.cells.splice(72, 9, 1, -1, 1, 1, -1, -1, -1, 1, 0);
  state.next = 8;
  const next = UTT.play(state, 80);
  assert.equal(next.won[8], 2);
  assert.equal(next.winner, 2);
  assert.deepEqual(UTT.legal(next), []);
});

test('the README animation is a complete legal recorded game', () => {
  let state = UTT.create();
  assert.deepEqual(replay.moves.slice(0, replay.opening.length), replay.opening);
  for (const move of replay.moves) {
    assert.ok(UTT.legal(state).includes(move), `Illegal recorded move: ${move}`);
    state = UTT.play(state, move);
  }
  assert.equal(({1:'X_WIN', '-1':'O_WIN', 2:'DRAW'})[state.winner], replay.result);
});

test('100 seeded full games preserve routing, occupancy, and immutability', () => {
  let seed = 194;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let game = 0; game < 100; game++) {
    let state = UTT.create();
    for (let ply = 0; ply < 81 && !state.winner; ply++) {
      const moves = UTT.legal(state);
      assert.ok(moves.length > 0);
      const before = JSON.stringify(state);
      const next = UTT.play(state, moves[Math.floor(random() * moves.length)]);
      assert.equal(JSON.stringify(state), before);
      assert.equal(next.cells.filter(Boolean).length, ply + 1);
      assert.equal(next.current, -state.current);
      assert.ok(UTT.legal(next).every(action => next.cells[action] === 0 && next.won[Math.floor(action / 9)] === 0));
      if (next.next >= 0) assert.ok(UTT.legal(next).every(action => Math.floor(action / 9) === next.next));
      state = next;
    }
    assert.notEqual(state.winner, 0);
  }
});

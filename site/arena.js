/* Ultimate Tic-Tac-Toe rules. Cells are board * 9 + square; X = 1, O = -1. */
(function (root) {
  "use strict";
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
    [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
  ];

  function create() {
    return { cells: Array(81).fill(0), won: Array(9).fill(0), next: -1,
      current: 1, winner: 0, last: -1 };
  }

  function lineWinner(values) {
    for (const [a, b, c] of LINES) {
      if ((values[a] === 1 || values[a] === -1) && values[a] === values[b] && values[a] === values[c]) {
        return values[a];
      }
    }
    return 0;
  }

  function legal(state) {
    if (state.winner) return [];
    const forced = state.next >= 0 && state.won[state.next] === 0;
    const moves = [];
    for (let board = 0; board < 9; board++) {
      if (state.won[board] || (forced && board !== state.next)) continue;
      for (let cell = 0; cell < 9; cell++) {
        const index = board * 9 + cell;
        if (state.cells[index] === 0) moves.push(index);
      }
    }
    return moves;
  }

  function play(state, index) {
    if (!Number.isInteger(index) || !legal(state).includes(index)) {
      throw new RangeError("That cell is not a legal move.");
    }
    const result = { ...state, cells: state.cells.slice(), won: state.won.slice() };
    const board = Math.floor(index / 9);
    const cell = index % 9;
    result.cells[index] = state.current;
    const mini = result.cells.slice(board * 9, board * 9 + 9);
    result.won[board] = lineWinner(mini) || (mini.every(Boolean) ? 2 : 0);
    result.winner = lineWinner(result.won) || (result.won.every(Boolean) ? 2 : 0);
    result.next = result.won[cell] ? -1 : cell;
    result.current = -state.current;
    result.last = index;
    return result;
  }

  const api = { create, legal, play };
  root.UTT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

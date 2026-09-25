(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const boardEl = $("arena-board");
  const statusEl = $("arena-status");
  const heatEl = $("arena-heat");
  const pending = new Map();
  let state = UTT.create();
  let worker = null;
  let workerVersion = 0;
  let requestNumber = 0;
  let position = 0;
  let phase = "loading";
  let ready = false;
  let analysis = null;
  let loadTimer = null;
  let focusAfterBot = false;
  let explanation = "You move first. Choose any square; that square sends O to the matching board.";

  const symbol = value => value === 1 ? "×" : value === -1 ? "○" : "";
  const squareName = index => "board " + (Math.floor(index / 9) + 1) + ", cell " + (index % 9 + 1);

  function clearPending() {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  }

  function setModelStatus(text, type) {
    $("model-state").textContent = text;
    $("model-dot").className = "model-dot" + (type ? " " + type : "");
  }

  function failure(stage) {
    clearTimeout(loadTimer);
    clearPending();
    workerVersion++;
    if (worker) worker.terminate();
    worker = null;
    phase = "error";
    ready = false;
    $("error-panel").hidden = false;
    $("error-message").textContent = stage === "load"
      ? "The trained model could not load. Check your connection, then retry."
      : "The model could not finish this position. Retry to continue your game.";
    setModelStatus("Model unavailable", "failed");
    render();
  }

  function request(kind) {
    if (!ready || !worker || state.winner) return;
    const id = workerVersion + ":" + (++requestNumber);
    const snapshot = position;
    const timer = setTimeout(() => {
      if (pending.has(id) && position === snapshot) failure(kind);
      pending.delete(id);
    }, 90000);
    pending.set(id, { kind, position: snapshot, timer });
    worker.postMessage({ id, kind, state, simulations: 64 });
  }

  function startWorker() {
    workerVersion++;
    const version = workerVersion;
    clearPending();
    clearTimeout(loadTimer);
    if (worker) worker.terminate();
    worker = null;
    ready = false;
    analysis = null;
    phase = "loading";
    $("error-panel").hidden = true;
    setModelStatus("Loading model");
    render();
    try {
      worker = new Worker("ai-worker.js");
    } catch (error) {
      failure("load");
      return;
    }
    loadTimer = setTimeout(() => {
      if (version === workerVersion && !ready) failure("load");
    }, 30000);
    worker.onerror = () => { if (version === workerVersion) failure(ready ? "search" : "load"); };
    worker.onmessage = ({ data }) => {
      if (version !== workerVersion) return;
      if (data.type === "ready") {
        clearTimeout(loadTimer);
        ready = true;
        $("error-panel").hidden = true;
        setModelStatus("Running on your device", "ready");
        continueGame();
        return;
      }
      if (data.type === "error" && !data.id) { failure("load"); return; }
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if (entry.position !== position) return;
      if (data.type === "error") { failure(entry.kind); return; }
      if (data.type !== "result") return;
      if (entry.kind === "evaluate") {
        if (!data.result || !Array.isArray(data.result.policy) || data.result.policy.length !== 81 ||
            !data.result.policy.every(value => Number.isFinite(value) && value >= 0)) { failure("evaluate"); return; }
        analysis = data.result;
        render();
      } else {
        const move = data.result && data.result.action;
        if (!Number.isInteger(move) || !UTT.legal(state).includes(move)) { failure("search"); return; }
        const board = Math.floor(move / 9);
        const before = state;
        state = UTT.play(state, move);
        position++;
        analysis = null;
        explanation = "O played " + squareName(move) + ". " +
          (state.won[board] === -1 && !before.won[board] ? "It won that small board. " : "") +
          (state.winner ? "" : state.next === -1 ? "That destination is finished, so you can choose any open board." : "Your next move is in board " + (state.next + 1) + ".");
        const restoreFocus = focusAfterBot && (document.activeElement === document.body || boardEl.contains(document.activeElement));
        focusAfterBot = false;
        continueGame();
        if (restoreFocus) focusFirstLegal();
      }
    };
  }

  function continueGame() {
    phase = state.winner ? "done" : state.current === 1 ? "human" : "thinking";
    render();
    if (!state.winner) request(state.current === 1 ? "evaluate" : "search");
  }

  function humanMove(index) {
    if (phase !== "human" || !UTT.legal(state).includes(index)) return;
    focusAfterBot = boardEl.contains(document.activeElement);
    clearPending();
    state = UTT.play(state, index);
    position++;
    analysis = null;
    explanation = "You played " + squareName(index) + ". " +
      (state.winner ? "" : state.next === -1 ? "The model can choose any open board." : "The model must play in board " + (state.next + 1) + ".");
    continueGame();
  }

  function focusFirstLegal() {
    const first = boardEl.querySelector("button:not(:disabled)");
    if (first) first.focus({ preventScroll: true });
    else if (state.winner) $("arena-reset").focus({ preventScroll: true });
  }

  function navigateBoard(event) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const source = event.target.closest("button[data-index]");
    if (!source) return;
    event.preventDefault();
    const available = Array.from(boardEl.querySelectorAll("button:not(:disabled)"));
    const geometry = index => {
      const board = Math.floor(index / 9), cell = index % 9;
      return { row: Math.floor(board / 3) * 3 + Math.floor(cell / 3), col: board % 3 * 3 + cell % 3 };
    };
    const current = geometry(Number(source.dataset.index));
    const ordered = available.slice().sort((a, b) => {
      const first = geometry(Number(a.dataset.index)), second = geometry(Number(b.dataset.index));
      return first.row * 9 + first.col - second.row * 9 - second.col;
    });
    if (event.key === "Home" || event.key === "End") {
      const destination = event.key === "Home" ? ordered[0] : ordered[ordered.length - 1];
      if (destination) destination.focus();
      return;
    }
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const candidates = available.filter(button => {
      const point = geometry(Number(button.dataset.index));
      return vertical ? point.col === current.col && (point.row - current.row) * direction > 0
        : point.row === current.row && (point.col - current.col) * direction > 0;
    });
    candidates.sort((a, b) => {
      const first = geometry(Number(a.dataset.index)), second = geometry(Number(b.dataset.index));
      return vertical ? (first.row - second.row) * direction : (first.col - second.col) * direction;
    });
    if (candidates[0]) candidates[0].focus();
  }

  function render() {
    const focused = boardEl.contains(document.activeElement) ? document.activeElement.dataset.index : undefined;
    const moves = new Set(UTT.legal(state));
    const showHints = heatEl.checked && analysis && phase === "human";
    const maxPolicy = showHints ? Math.max(...Array.from(moves, index => analysis.policy[index])) : 0;
    const best = showHints ? Array.from(moves).reduce((top, index) => analysis.policy[index] > analysis.policy[top] ? index : top) : -1;
    const fragment = document.createDocumentFragment();
    for (let board = 0; board < 9; board++) {
      const mini = document.createElement("div");
      const active = !state.winner && !state.won[board] && (state.next === -1 || state.next === board);
      mini.className = "mini-board" + (active ? " active" : "") + (state.won[board] ? " finished" : "");
      mini.dataset.winner = state.won[board] === 1 ? "X" : state.won[board] === -1 ? "O" : state.won[board] === 2 ? "draw" : "";
      mini.setAttribute("role", "group");
      mini.setAttribute("aria-label", "Board " + (board + 1) + (state.won[board] ? ", " + (state.won[board] === 2 ? "drawn" : mini.dataset.winner + " won") : ""));
      for (let cell = 0; cell < 9; cell++) {
        const index = board * 9 + cell;
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.index = String(index);
        button.className = "cell" + (state.cells[index] === 1 ? " x" : state.cells[index] === -1 ? " o" : "") + (moves.has(index) ? " legal" : "") + (state.last === index ? " last" : "");
        button.textContent = symbol(state.cells[index]);
        button.disabled = phase !== "human" || !moves.has(index);
        let label = "Board " + (board + 1) + ", cell " + (cell + 1) + ", " + (state.cells[index] === 1 ? "X" : state.cells[index] === -1 ? "O" : moves.has(index) ? "available" : "unavailable");
        if (showHints && moves.has(index)) {
          const probability = analysis.policy[index];
          button.style.setProperty("--heat", maxPolicy ? (probability / maxPolicy).toFixed(4) : "0");
          button.dataset.policy = String(probability);
          button.title = "Network preference: " + (probability * 100).toFixed(1) + "% (not a win probability)";
          label += ", network preference " + (probability * 100).toFixed(1) + " percent";
          if (index === best) button.classList.add("hint-best");
        }
        button.setAttribute("aria-label", label);
        mini.appendChild(button);
      }
      fragment.appendChild(mini);
    }
    boardEl.replaceChildren(fragment);
    boardEl.classList.toggle("heat-on", Boolean(showHints));
    boardEl.setAttribute("aria-busy", String(phase === "loading" || phase === "thinking"));
    statusEl.classList.toggle("is-terminal", Boolean(state.winner));
    statusEl.textContent = phase === "error" ? "Game paused. Retry the model to continue." :
      phase === "loading" ? "Loading the trained model…" :
      state.winner === 2 ? "It’s a draw. Try another match." :
      state.winner === 1 ? "You win! Three small boards in a row." :
      state.winner === -1 ? "The neural net wins this one. Play again?" :
      phase === "thinking" ? "The neural net is looking ahead…" :
      state.next === -1 ? "Your turn. Choose any open board." : "Your turn. Play in board " + (state.next + 1) + ".";
    $("arena-explain").textContent = explanation;
    heatEl.disabled = !ready || Boolean(state.winner);
    $("hint-legend").hidden = !showHints;
    $("hint-note").hidden = !heatEl.checked || phase !== "human";
    $("hint-note").textContent = showHints ? "These are the network’s preferences for your next move, before search. Brighter is stronger; the percentages are not win chances." : "Reading the network’s preferences for this position…";
    if (focused !== undefined && phase === "human") {
      const nextFocus = boardEl.querySelector('button[data-index="' + focused + '"]:not(:disabled)');
      if (nextFocus) nextFocus.focus({ preventScroll: true });
    }
  }

  boardEl.addEventListener("click", event => {
    const button = event.target.closest("button[data-index]");
    if (button) humanMove(Number(button.dataset.index));
  });
  boardEl.addEventListener("keydown", navigateBoard);
  heatEl.addEventListener("change", render);
  $("model-retry").addEventListener("click", startWorker);
  $("arena-reset").addEventListener("click", () => {
    state = UTT.create();
    position++;
    analysis = null;
    focusAfterBot = false;
    explanation = "You move first. Choose any square; that square sends O to the matching board.";
    // Terminate outstanding search as well as invalidating its request IDs.
    if (phase === "thinking" || phase === "error" || phase === "loading") startWorker();
    else { clearPending(); continueGame(); }
  });

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const next = theme === "dark" ? "light" : "dark";
    $("theme-toggle").innerHTML = (next === "light" ? "Light theme" : "Dark theme") + ' <span aria-hidden="true">◐</span>';
    $("theme-toggle").setAttribute("aria-label", "Switch to " + next + " theme");
  }
  let theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  try { const saved = localStorage.getItem("utt-theme"); if (saved === "light" || saved === "dark") theme = saved; } catch (_) { /* Storage may be blocked; the game still works. */ }
  setTheme(theme);
  $("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("utt-theme", next); } catch (_) { /* Optional preference. */ }
  });
  startWorker();
})();

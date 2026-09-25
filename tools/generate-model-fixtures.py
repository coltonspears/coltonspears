"""Regenerate browser parity fixtures using the original PyTorch implementation.

Usage: python tools/generate-model-fixtures.py --source ../utt-model
Requires that source checkout's Python dependencies (numpy and torch).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import types
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve()
sys.path.insert(0, str(source / "src"))
# Load the unchanged core modules without the package's eager __init__ imports,
# which also pull in unrelated benchmark/training dependencies such as MLflow.
package = types.ModuleType("uttarena_ml")
package.__path__ = [str(source / "src/uttarena_ml")]
sys.modules["uttarena_ml"] = package

import numpy as np
import torch
from uttarena_ml.export import load_model_export
from uttarena_ml.game import GameState, encode_features
from uttarena_ml.evaluator import TorchEvaluator
from uttarena_ml.mcts import PuctMcts, MctsConfig

torch.set_num_threads(1)
torch.use_deterministic_algorithms(True)
project = Path(__file__).resolve().parents[1]
weights = project / "site/models/generation-168.bin"
model, stats = load_model_export(weights)
evaluator = TorchEvaluator(model, use_autocast=False)
searcher = PuctMcts(evaluator, MctsConfig(simulations=64, dirichlet_fraction=0))

def play(actions):
    state = GameState.initial()
    for action in actions:
        state = state.apply_move(action)
    return state

def constructed(boards, current=1, forced=None):
    cells = [0] * 81
    for index, board in boards.items():
        cells[index * 9:index * 9 + 9] = board
    return GameState.from_cells(cells, current, forced, sum(bool(c) for c in cells))

x_win = [1, 1, 1, 2, 2, 0, 0, 0, 0]
o_win = [2, 2, 2, 1, 1, 0, 0, 0, 0]
draw = [1, 2, 1, 1, 2, 2, 2, 1, 1]
weak_moves = json.loads((source / "reports/weak-position.json").read_text())["moves"]
cases = [
    ("initial", GameState.initial()),
    ("forced-board-o", play([40])),
    ("forced-board-midgame", play([40, 36, 0, 1, 9, 2, 20, 18, 4, 37, 12, 30])),
    ("published-weak-position", play(weak_moves)),
    ("local-wins-and-draw-forced", constructed({0: x_win, 1: o_win, 2: draw, 4: [1, 1, 0, 0, 2, 2, 0, 0, 0]}, 2, 4)),
    ("closed-destination-free-choice", constructed({0: x_win, 1: o_win, 2: draw, 4: [1, 1, 0, 0, 2, 2, 0, 0, 0]}, 1, 2)),
    ("immediate-macro-win", constructed({0: x_win, 1: x_win, 2: [1, 1, 0, 2, 2, 0, 0, 0, 0]}, 1, 2)),
    ("terminal-loss", constructed({0: x_win, 1: x_win, 2: x_win}, 2)),
    ("terminal-win", constructed({0: x_win, 1: x_win, 2: x_win}, 1)),
    ("terminal-draw", constructed({i: draw for i in range(9)}, 2)),
]

def browser_state(state):
    return {
        "cells": [-1 if c == 2 else c for c in state.cells],
        "won": [-1 if r == 2 else 2 if r == 3 else r for r in state.local_results],
        "next": -1 if state.forced_board is None else state.forced_board,
        "current": 1 if state.next_player == 1 else -1,
        "winner": -1 if state.result == 2 else 2 if state.result == 3 else int(state.result),
        "last": -1,
    }

rows = []
for name, state in cases:
    if state.is_terminal:
        evaluation = {"policy": [0.0] * 81, "value": float(state.terminal_value)}
    else:
        ev = evaluator.evaluate([state])[0]
        with torch.inference_mode():
            logits, _ = model(torch.from_numpy(encode_features(state)[None]))
        evaluation = {"policy": ev.priors.tolist(), "value": ev.value, "logits": logits[0].tolist()}
    result = searcher.search(state)
    rows.append({
        "name": name, "state": browser_state(state), "legal": list(state.legal_actions),
        "evaluation": evaluation,
        "search": {
            "action": result.action, "visits": result.visit_counts.tolist(),
            "value": result.root_value, "simulations": result.simulations_completed,
        },
    })

fixture = {
    "generator": "Original uttarena_ml PyTorch CPU FP32 model/evaluator/PUCT, no root noise",
    "source_repository": "https://github.com/coltonspears/ultimate-tic-tac-toe-ml",
    "source_commit": subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip(),
    "torch_version": torch.__version__, "numpy_version": np.__version__,
    "file_sha256": hashlib.sha256(weights.read_bytes()).hexdigest(),
    "payload_sha256": stats.sha256, "cases": rows,
}
destination = project / "tests/fixtures/model-parity.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
print(f"Generated {len(rows)} original PyTorch evaluation + 64-simulation PUCT cases: {destination}")

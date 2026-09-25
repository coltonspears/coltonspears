# Profile and playable arena

The root README is the live GitHub profile. GitHub renders its native text and
tables, with linked light/dark SVG artwork from `assets/`. Clicking the game
banner opens the separate GitHub Pages arena at
<https://coltonspears.github.io/coltonspears/>.

## Local preview

Run from the repository root:

```sh
python -m http.server 8767 --directory site
```

Open <http://localhost:8767/>. Use HTTP rather than opening the HTML directly:
the model is loaded with `fetch` and inference runs in a Web Worker.
No npm installation, backend, account, analytics, or external inference API is needed.

## Model and evaluation

The arena loads the real generation-168 FP32 export from
[Ultimate Tic-Tac-Toe ML](https://github.com/coltonspears/ultimate-tic-tac-toe-ml).
The JavaScript port implements the seven current-player-relative input planes,
shared local encoder, macro encoder, policy/value heads, and deterministic PUCT
search with 64 simulations and no root noise. Browser floating-point arithmetic
can differ slightly from PyTorch and produce different moves near ties.

Model provenance, license, and hashes live alongside the weights in `site/models/`.
The model's value is an outcome estimate, not a calibrated win probability.
The profile's evaluation numbers describe the linked original reports; they
are not claimed as fresh browser benchmarks or human playing strength.

Run the regression suite before publishing:

```sh
node --test tests/*.test.cjs
```

It checks game rules, model parsing/integrity, legal masking, and inference
against reference fixtures. Browser checks should cover loading, first move,
reset during search, hints, narrow screens, and failed model loading.

## Publishing

`.github/workflows/pages.yml` runs tests and deploys **only `site/`** after changes
to the arena. The repository's Pages source is GitHub Actions. Pull requests run
tests without publishing. Actions are pinned to reviewed release commits.

The contribution snake has its own daily workflow and `output` branch. Profile
art is committed to `main`, so publishing the snake cannot overwrite it.

## Updating profile artwork

```sh
node scripts/build-art.cjs
```

The hero replays a recorded generation-168 evaluation match; its source metadata
and moves are in `assets/replay.json`. The project-card art is illustrative and
does not represent actual classifier outputs or a specific pull request.

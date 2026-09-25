# Trained browser model

`generation-168.bin` is the unmodified FP32 export from
[ultimate-tic-tac-toe-ml](https://github.com/coltonspears/ultimate-tic-tac-toe-ml),
source commit `eb91a0272b2ce101e14b12591ef470164f7a8e47`, path
`reports/generation-168.bin`. The original model's provenance is copied unchanged
to `provenance.json`; its published-weights checksum refers to the original
PyTorch weights, not this portable binary. The original MIT license is in `LICENSE`.

- Generation: 168; training step: 250.
- Network: shared hierarchical MLP, 132,266 FP32 parameters.
- File size: 530,049 bytes.
- Complete file SHA-256: `fde1a058407b21ee62016365edf900922f77ea1eadefe5f31d735d8d222f17a0`.
- Payload SHA-256 (stored as the last 32 bytes): `b5ec21b6f84da3fe28d2e977a9e0b510b44afbd1b0a261ee154177503ff2526a`.

`../model.js` implements the actual trained affine/ReLU/tanh network in vanilla
JavaScript. It verifies the embedded SHA-256 checksum, exact schema/architecture,
tensor names/order/shapes, finite weights, and payload length before inference.
This integrity check detects corrupted model downloads; it is not a signature.
Use the complete file checksum above to identify this particular trained model.
HTTPS or localhost is required for Web Crypto.

Features and values are relative to the player to move. Policy probabilities
are normalized over legal moves only. Terminal positions return an exact outcome
and an all-zero policy. Search uses deterministic PUCT with `c_puct=1.5`, 64
simulations by default, no root noise, alternating value signs, and the smallest
action ID to break ties. Search policy is the normalized visit count, while
evaluation policy is the network's prior. Neither is an objective win probability;
the value is a learned outcome estimate. No game data leaves the browser.

The JavaScript uses FP32 layer outputs with JavaScript's double-precision sums.
Small floating-point differences from PyTorch are expected. Checked-in fixtures
test policy/value/logit parity and exact deterministic search visits against the
original PyTorch implementation on initial, forced, won/drawn, tactical, and
terminal positions. Regenerate with
`python tools/generate-model-fixtures.py --source /path/to/ultimate-tic-tac-toe-ml`.

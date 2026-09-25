/* Browser inference for UTT Arena's trained generation-168 network.
 * Architecture and PUCT ported from ultimate-tic-tac-toe-ml (MIT).
 * See models/README.md and models/LICENSE for provenance and license.
 */
(function (root) {
  "use strict";

  const ARCHITECTURE = '{"action_order":"board*9+cell","affine_initialization":"torch.nn.Linear.reset_parameters","fp32_bytes":529064,"hidden_activation":"relu","input_shape":[7,9,9],"local_board_order":"row-major","local_encoder":[63,64,32],"macro_encoder":[288,256,128],"name":"hierarchical-shared-mlp","parameter_count":132266,"policy_head":[160,64,9],"value_activation":"tanh","value_head":[128,64,1],"version":1}';
  const LAYERS = [
    ["local_fc1", 63, 64], ["local_fc2", 64, 32],
    ["macro_fc1", 288, 256], ["macro_fc2", 256, 128],
    ["policy_fc1", 160, 64], ["policy_fc2", 64, 9],
    ["value_fc1", 128, 64], ["value_fc2", 64, 1]
  ];
  const FILE_SHA256 = "fde1a058407b21ee62016365edf900922f77ea1eadefe5f31d735d8d222f17a0";
  const PAYLOAD_SHA256 = "b5ec21b6f84da3fe28d2e977a9e0b510b44afbd1b0a261ee154177503ff2526a";

  function hex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function fromBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError("Model must be an ArrayBuffer.");
    if (buffer.byteLength < 60) throw new Error("Model export is too short.");
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error("Model integrity checking requires HTTPS or localhost.");
    }
    // Copy before the asynchronous digest so callers cannot change verified bytes.
    const bytes = new Uint8Array(buffer.slice(0));
    const end = bytes.length - 32;
    const digest = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes.subarray(0, end)));
    if (hex(digest) !== hex(bytes.subarray(end))) throw new Error("Model SHA-256 checksum mismatch.");

    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let offset = 0;
    function take(size) {
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > end) {
        throw new Error("Model export ended unexpectedly.");
      }
      const start = offset;
      offset += size;
      return start;
    }
    const u8 = () => view.getUint8(take(1));
    const u16 = () => view.getUint16(take(2), true);
    const u32 = () => view.getUint32(take(4), true);
    function u64() {
      const start = take(8);
      const result = view.getUint32(start, true) + view.getUint32(start + 4, true) * 4294967296;
      if (!Number.isSafeInteger(result)) throw new Error("Model integer is too large.");
      return result;
    }
    function text(size) {
      const start = take(size);
      return decoder.decode(bytes.subarray(start, start + size));
    }
    if (text(8) !== "UTTAPV01") throw new Error("Model magic mismatch.");
    if (u32() !== 1) throw new Error("Unsupported model schema.");
    const metadataLength = u32();
    if (metadataLength !== ARCHITECTURE.length) throw new Error("Model architecture size mismatch.");
    if (u32() !== 16) throw new Error("Model tensor count mismatch.");
    if (u64() !== 529064) throw new Error("Model weight byte count mismatch.");
    if (text(metadataLength) !== ARCHITECTURE) throw new Error("Unsupported model architecture.");

    const layers = {};
    for (const [name, inputs, outputs] of LAYERS) {
      const layer = { inputs, outputs };
      for (const [kind, dimensions] of [["weight", [outputs, inputs]], ["bias", [outputs]]]) {
        const nameLength = u16();
        const rank = u8();
        if (u8() !== 0) throw new Error("Model tensor reserved flags must be zero.");
        const count = u64();
        if (text(nameLength) !== name + "." + kind) throw new Error("Model tensor name/order mismatch.");
        if (rank !== dimensions.length) throw new Error("Model tensor rank mismatch.");
        for (const dimension of dimensions) {
          if (u32() !== dimension) throw new Error("Model tensor shape mismatch.");
        }
        if (count !== dimensions.reduce((a, b) => a * b, 1)) throw new Error("Model tensor element count mismatch.");
        const values = new Float32Array(count);
        const start = take(count * 4);
        for (let i = 0; i < count; i++) {
          const value = view.getFloat32(start + i * 4, true);
          if (!Number.isFinite(value)) throw new Error("Model contains a non-finite weight.");
          values[i] = value;
        }
        layer[kind] = values;
      }
      layers[name] = layer;
    }
    if (offset !== end) throw new Error("Model contains trailing payload bytes.");
    return makeModel(layers, hex(digest));
  }

  function affine(input, layer, relu) {
    const output = new Float32Array(layer.outputs);
    const weights = layer.weight;
    for (let row = 0; row < layer.outputs; row++) {
      let sum = layer.bias[row];
      const start = row * layer.inputs;
      for (let col = 0; col < layer.inputs; col++) sum += weights[start + col] * input[col];
      output[row] = relu ? Math.max(0, sum) : sum;
    }
    return output;
  }

  function game() {
    if (!root.UTT || typeof root.UTT.legal !== "function" || typeof root.UTT.play !== "function") {
      throw new Error("Load arena.js before evaluating the model.");
    }
    return root.UTT;
  }

  function validateState(state) {
    if (!state || !state.cells || state.cells.length !== 81 || !state.won || state.won.length !== 9 ||
        ![1, -1].includes(state.current) || !Number.isInteger(state.next) || state.next < -1 || state.next > 8 ||
        ![0, 1, -1, 2].includes(state.winner) ||
        !Array.from(state.cells).every(value => [0, 1, -1].includes(value)) ||
        !Array.from(state.won).every(value => [0, 1, -1, 2].includes(value))) {
      throw new TypeError("Invalid Ultimate Tic-Tac-Toe state.");
    }
  }

  function terminalValue(state) {
    return state.winner === 2 ? 0 : state.winner === state.current ? 1 : -1;
  }

  function makeModel(layers, checksum) {
    function evaluate(state) {
      validateState(state);
      const policy = Array(81).fill(0);
      if (state.winner) return { policy, value: terminalValue(state), logits: Array(81).fill(-Infinity) };
      const moves = game().legal(state);
      if (!moves.length) throw new Error("Non-terminal state has no legal moves.");
      const legal = new Set(moves);
      const embeddings = new Float32Array(288);
      const forced = state.next >= 0 && state.won[state.next] === 0 ? state.next : -1;

      // This is exactly extract_local_boards(encode_features(state)): seven
      // channel-major 3x3 planes per board, then board-major embeddings.
      for (let board = 0; board < 9; board++) {
        const input = new Float32Array(63);
        for (let cell = 0; cell < 9; cell++) {
          const action = board * 9 + cell;
          input[cell] = state.cells[action] === state.current ? 1 : 0;
          input[9 + cell] = state.cells[action] === -state.current ? 1 : 0;
          input[18 + cell] = state.won[board] === state.current ? 1 : 0;
          input[27 + cell] = state.won[board] === -state.current ? 1 : 0;
          input[36 + cell] = state.won[board] === 2 ? 1 : 0;
          input[45 + cell] = legal.has(action) ? 1 : 0;
          input[54 + cell] = forced === board ? 1 : 0;
        }
        embeddings.set(affine(affine(input, layers.local_fc1, true), layers.local_fc2, true), board * 32);
      }
      const macro = affine(affine(embeddings, layers.macro_fc1, true), layers.macro_fc2, true);
      const logits = Array(81);
      for (let board = 0; board < 9; board++) {
        const input = new Float32Array(160);
        input.set(embeddings.subarray(board * 32, board * 32 + 32));
        input.set(macro, 32);
        const localLogits = affine(affine(input, layers.policy_fc1, true), layers.policy_fc2, false);
        for (let cell = 0; cell < 9; cell++) logits[board * 9 + cell] = localLogits[cell];
      }
      const rawValue = affine(affine(macro, layers.value_fc1, true), layers.value_fc2, false)[0];
      const maximum = Math.max(...moves.map(action => logits[action]));
      let total = 0;
      for (const action of moves) { policy[action] = Math.exp(logits[action] - maximum); total += policy[action]; }
      for (const action of moves) policy[action] /= total;
      return { policy, value: Math.tanh(rawValue), logits };
    }

    function search(state, simulations = 64) {
      validateState(state);
      if (!Number.isInteger(simulations) || simulations < 0 || simulations > 4096) {
        throw new RangeError("Simulation count must be an integer from 0 to 4096.");
      }
      const visits = Array(81).fill(0);
      const policy = Array(81).fill(0);
      if (state.winner || simulations === 0) {
        return { action: null, visits, policy, value: state.winner ? terminalValue(state) : null, simulations: 0 };
      }
      const rules = game();
      const nodes = new Map();
      function nodeFor(position) {
        const forced = position.next >= 0 && position.won[position.next] === 0 ? position.next : -1;
        const key = position.current + "/" + forced + "/" + position.won.join(",") + "/" + position.cells.join(",");
        if (!nodes.has(key)) nodes.set(key, { state: position, edges: null, visits: 0, sum: 0 });
        return nodes.get(key);
      }
      function expand(node) {
        const evaluation = evaluate(node.state);
        node.edges = rules.legal(node.state).map(action => ({ action, prior: evaluation.policy[action], visits: 0, sum: 0, child: null }));
        return evaluation.value;
      }
      const rootNode = nodeFor(state);
      expand(rootNode); // Root inference is not one of the search simulations.
      for (let simulation = 0; simulation < simulations; simulation++) {
        let node = rootNode;
        const path = [];
        while (node.edges && !node.state.winner) {
          const scale = 1.5 * Math.sqrt(node.visits + 1);
          let selected = null;
          let bestScore = -Infinity;
          for (const edge of node.edges) {
            const score = (edge.visits ? edge.sum / edge.visits : 0) + scale * edge.prior / (1 + edge.visits);
            if (score > bestScore) { selected = edge; bestScore = score; }
          }
          path.push([node, selected]);
          if (!selected.child) selected.child = nodeFor(rules.play(node.state, selected.action));
          node = selected.child;
        }
        let value = node.state.winner ? terminalValue(node.state) : expand(node);
        node.visits++;
        node.sum += value;
        for (let i = path.length - 1; i >= 0; i--) {
          value = -value;
          const [parent, edge] = path[i];
          edge.visits++;
          edge.sum += value;
          parent.visits++;
          parent.sum += value;
        }
      }
      let action = null;
      let mostVisits = -1;
      for (const edge of rootNode.edges) {
        visits[edge.action] = edge.visits;
        policy[edge.action] = edge.visits / simulations;
        if (edge.visits > mostVisits) { mostVisits = edge.visits; action = edge.action; }
      }
      return { action, visits, policy, value: rootNode.sum / rootNode.visits, simulations };
    }

    return Object.freeze({ evaluate, search, checksum, architecture: Object.freeze(JSON.parse(ARCHITECTURE)) });
  }

  const api = Object.freeze({ fromBuffer, FILE_SHA256, PAYLOAD_SHA256 });
  root.UTTModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);

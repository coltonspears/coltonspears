"use strict";

// Inference and tree search stay off the UI thread.
importScripts("arena.js", "model.js");

const ready = (async () => {
  const response = await fetch(new URL("models/generation-168.bin", self.location.href));
  if (!response.ok) throw new Error("Model download returned HTTP " + response.status);
  const model = await UTTModel.fromBuffer(await response.arrayBuffer());
  self.postMessage({ type: "ready" });
  return model;
})();

ready.catch(error => {
  self.postMessage({ type: "error", stage: "load", message: error.message });
});

self.onmessage = async ({ data }) => {
  if (!data || typeof data.id !== "string") return;
  try {
    const model = await ready;
    if (data.kind !== "search" && data.kind !== "evaluate") throw new Error("Unknown model request");
    const result = data.kind === "search"
      ? await model.search(data.state, 64)
      : await model.evaluate(data.state);
    self.postMessage({ type: "result", id: data.id, result });
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, stage: data.kind, message: error.message });
  }
};

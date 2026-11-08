/// Web Worker that loads the Wasm parser and processes files

let wasmModule: any = null;

async function initWasm() {
  if (wasmModule) return wasmModule;

  try {
    const wasm = await import('@archviewer/wasm-parser');
    await wasm.default();
    wasmModule = wasm;
    return wasm;
  } catch (error) {
    throw new Error(`Failed to initialize Wasm parser: ${error}`);
  }
}

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, files } = event.data;

  if (type === 'parse') {
    try {
      const wasm = await initWasm();
      const filesJson = JSON.stringify(files);
      const resultJson = wasm.parse_project(filesJson);
      const data = JSON.parse(resultJson);
      self.postMessage({ type: 'result', data });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : 'Parse failed',
      });
    }
  }
});

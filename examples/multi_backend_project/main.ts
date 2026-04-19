import { greet } from 'mbt:my';
import HeavyWorker from './worker.ts?worker';

const worker = new HeavyWorker();
worker.postMessage(30);
worker.onmessage = (ev) => {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <h2>JS backend</h2>
    <pre>${greet()}</pre>
    <h2>wasm-gc backend (via Web Worker)</h2>
    <pre>fibonacci(30) = ${ev.data}</pre>
  `;
};

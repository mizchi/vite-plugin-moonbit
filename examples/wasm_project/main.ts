/// <reference types="vite/client" />
import init from './target/wasm-gc/release/build/app.wasm?init';
const instance = await init();
const { add } = instance.exports as { add: (a: number, b: number) => number };
console.log('WASM module loaded:', instance.exports);

// Test add function
const result = add(2, 3);
console.log('add(2, 3) =', result);

// Display result
const app = document.getElementById('app')!;
app.innerHTML = `
  <p>add(2, 3) = <strong>${result}</strong></p>
`;

/// <reference lib="webworker" />
import init from 'mbtw:my/heavy';

const instance = await init();
const { fibonacci } = instance.exports as { fibonacci: (n: number) => number };

self.onmessage = (ev: MessageEvent<number>) => {
  self.postMessage(fibonacci(ev.data));
};

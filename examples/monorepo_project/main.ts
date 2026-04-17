import { greet } from 'mbt:internal/app';
import { banner } from 'mbt:internal/shared';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h2>greet()</h2>
  <pre>${greet('world')}</pre>
  <h2>banner()</h2>
  <pre>${banner('direct from shared module')}</pre>
`;

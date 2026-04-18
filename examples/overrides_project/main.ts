import { greet_wrapped } from 'mbt:my/app';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h2>greet_wrapped()</h2>
  <pre>${greet_wrapped()}</pre>
  <p>
    The <code>my/app</code> package declares
    <code>overrides: ["impls/impl_a"]</code> in its <code>moon.pkg.json</code>,
    so moon links impl_a's <code>greet()</code> into the output. Switch the
    override to <code>impls/impl_b</code> and rebuild to see the other
    implementation.
  </p>
`;

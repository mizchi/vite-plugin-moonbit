// Test: Import MoonBit module via mbt: prefix
import { parse_markdown } from 'mbt:test/app';

console.log('MoonBit module loaded successfully!');
console.log('parse_markdown:', parse_markdown);

// Test markdown parsing
const markdown = `# Hello World

This is a **test** paragraph.

- Item 1
- Item 2
`;

const html = parse_markdown(markdown);
console.log('Parsed HTML:', html);

// Display result
const app = document.getElementById('app')!;
app.innerHTML = `
  <h2>Input (Markdown)</h2>
  <pre>${markdown}</pre>
  <h2>Output (HTML)</h2>
  <div>${html}</div>
`;
console.log('Rendered!');

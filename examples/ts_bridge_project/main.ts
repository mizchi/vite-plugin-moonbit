import { describe_scaled_point } from "mbt:internal/app";
import { formatPoint, scalePoint } from "./src/api/math.ts";

const app = document.getElementById("app")!;
const input = { x: 3, y: 4 };
const factor = 1.5;

const viaMoonBit = describe_scaled_point(input.x, input.y, factor);
const viaTypeScript = formatPoint(scalePoint(input.x, input.y, factor));

app.innerHTML = `
  <p><strong>TypeScript entry:</strong> <code>src/api/math.ts</code></p>
  <p><strong>MoonBit wrapper:</strong> <code>src/lib.mbt</code></p>
  <p><strong>Input:</strong> (${input.x}, ${input.y}) x ${factor}</p>
  <p><strong>Via MoonBit bridge:</strong> ${viaMoonBit}</p>
  <p><strong>Direct TypeScript:</strong> ${viaTypeScript}</p>
`;

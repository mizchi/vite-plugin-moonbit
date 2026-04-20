export interface Point {
  x: number;
  y: number;
}

export const pointKind: string = "cartesian";

export function scalePoint(x: number, y: number, factor: number): Point {
  return {
    x: x * factor,
    y: y * factor,
  };
}

export function formatPoint(point: Point): string {
  return `(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`;
}

export function unusedBridgeSentinel(): string {
  return "TS_BRIDGE_UNUSED_SENTINEL";
}

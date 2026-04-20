///|
/// `@math_bridge` comes from the generated package under `src/gen/math_bridge/`.
pub fn describe_scaled_point(x : Double, y : Double, factor : Double) -> String {
  let scaled = @math_bridge.scale_point(x, y, factor)
  "\{@math_bridge.get_point_kind()}: \{@math_bridge.format_point(scaled)}"
}

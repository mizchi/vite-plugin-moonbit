///|
/// Parse a `moon.pkg` / `moon.work` DSL source into a plain JSON-compatible
/// string. The caller is expected to `JSON.parse()` the return value.
///
/// On parse errors, returns a JSON `{ "error": [ ...messages ] }` payload so
/// the consumer doesn't have to deal with MoonBit exceptions across the FFI
/// boundary.
///
/// DSL-specific normalization: the `options(...)` block produces a nested
/// `options` object in the raw AST, but the equivalent `moon.pkg.json` shape
/// places those same keys (`virtual`, `link`, `targets`, `native-stub`,
/// `is-main`, etc.) at the top level. To give callers a single canonical
/// shape, the parser flattens `options.*` into the top-level object
/// (with top-level keys winning on any collision).
pub fn parse(src : String) -> String {
  let (ast, reports) = @pkg.parse_string(src)
  if reports.length() > 0 {
    let msgs = reports.map(fn(r) { r.to_string() })
    let msg_strs = msgs.map(fn(m) { "\"" + escape(m) + "\"" }).join(",")
    "{\"error\":[" + msg_strs + "]}"
  } else {
    to_plain_json(flatten_options(ast))
  }
}

///|
/// Merge the contents of an `options(...)` block into the top-level object
/// for parity with `moon.pkg.json`. Top-level keys take precedence over
/// options ones; anything other than Obj is left alone.
fn flatten_options(ast : @pkg.Ast) -> @pkg.Ast {
  match ast {
    Obj(map=m, loc=loc) =>
      match m.get("options") {
        Some(Obj(map=inner, ..)) => {
          let merged : Map[String, @pkg.Ast] = Map::new()
          for kv in inner.iter() {
            merged[kv.0] = kv.1
          }
          for kv in m.iter() {
            if kv.0 != "options" {
              merged[kv.0] = kv.1
            }
          }
          @pkg.Ast::Obj(map=merged, loc=loc)
        }
        _ => ast
      }
    _ => ast
  }
}

///|
fn escape(s : String) -> String {
  let buf = StringBuilder::new()
  for ch in s {
    match ch {
      '\\' => buf.write_string("\\\\")
      '"' => buf.write_string("\\\"")
      '\n' => buf.write_string("\\n")
      '\r' => buf.write_string("\\r")
      '\t' => buf.write_string("\\t")
      c if c < '\u{20}' => {
        let code = c.to_int()
        buf.write_string("\\u")
        buf.write_string(pad4_hex(code))
      }
      c => buf.write_char(c)
    }
  }
  buf.to_string()
}

///|
fn pad4_hex(n : Int) -> String {
  let buf = StringBuilder::new()
  buf.write_string(hex_digit((n >> 12) & 0xf))
  buf.write_string(hex_digit((n >> 8) & 0xf))
  buf.write_string(hex_digit((n >> 4) & 0xf))
  buf.write_string(hex_digit(n & 0xf))
  buf.to_string()
}

///|
fn hex_digit(n : Int) -> String {
  match n {
    0 => "0"
    1 => "1"
    2 => "2"
    3 => "3"
    4 => "4"
    5 => "5"
    6 => "6"
    7 => "7"
    8 => "8"
    9 => "9"
    10 => "a"
    11 => "b"
    12 => "c"
    13 => "d"
    14 => "e"
    _ => "f"
  }
}

///|
/// Walk the parser AST and emit a plain JSON string (no `type` tags,
/// no `loc` metadata).
fn to_plain_json(ast : @pkg.Ast) -> String {
  match ast {
    Null(_) => "null"
    True(_) => "true"
    False(_) => "false"
    Str(str=s, ..) => "\"" + escape(s) + "\""
    Float(float=n, ..) => n
    Arr(content=items, ..) => {
      let parts = items.map(fn(x) { to_plain_json(x) }).join(",")
      "[" + parts + "]"
    }
    Obj(map=m, ..) => {
      let parts = m
        .iter()
        .map(fn(kv) { "\"" + escape(kv.0) + "\":" + to_plain_json(kv.1) })
        .collect()
        .join(",")
      "{" + parts + "}"
    }
  }
}

///|
using @element {div, h1, p, button, text, text_dyn, events, type DomNode}

///|
using @resource {signal, memo}

///|
fn counter_app() -> DomNode {
  let count = signal(0)
  let doubled = memo(fn() { count.get() * 2 })
  div(class="app", [
    h1([text("Luna Counter Example")]),
    p([text_dyn(fn() { "Count: \{count.get()}" })]),
    p([text_dyn(fn() { "Doubled: \{doubled()}" })]),
    div(class="buttons", [
      button(on=events().click(fn(_) { count.update(fn(n) { n - 1 }) }), [
        text("-"),
      ]),
      button(on=events().click(fn(_) { count.update(fn(n) { n + 1 }) }), [
        text("+"),
      ]),
      button(on=events().click(fn(_) { count.set(0) }), [text("Reset")]),
    ]),
  ])
}

///|
fn main {
  let doc = @dom.document()
  match doc.getElementById("app") {
    Some(el) => @element.render_to(el, counter_app())
    None => println("Error: #app element not found")
  }
}

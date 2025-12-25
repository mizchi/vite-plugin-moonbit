// Luna Example - Minimal counter app

///|
using @element {div, h1, p, button, text, text_dyn, events}

///|
fn main {
  guard @dom.document().getElementById("app") is Some(el)
  @element.render(el |> @element.DomElement::from_jsdom, counter_app())
}

///|
fn counter_app() -> @element.DomNode {
  let count = @luna.signal(0)
  let doubled = @luna.memo(() => count.get() * 2)
  div([
    h1([text("Luna Counter Example")]),
    p([text_dyn(() => "Count: \{count.get()}")]),
    p([text_dyn(() => "Doubled: \{doubled()}")]),
    div(class="buttons", [
      button(on=events().click(_ => count.update(n => n - 1)), [text("-")]),
      button(on=events().click(_ => count.update(n => n + 1)), [text("+")]),
      button(on=events().click(_ => count.set(0)), [text("Reset")]),
    ]),
  ])
}

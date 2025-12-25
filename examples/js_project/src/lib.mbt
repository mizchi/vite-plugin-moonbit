///|
pub fn parse_markdown(input : String) -> String {
  let handle = @markdown.md_parse(input)
  let html = @markdown.md_render_to_html(handle)
  @markdown.md_free(handle)
  let x : String = 123
  html
}

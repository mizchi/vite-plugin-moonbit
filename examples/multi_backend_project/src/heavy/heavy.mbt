///|
pub fn fibonacci(n : Int) -> Int {
  if n < 2 {
    n
  } else {
    fibonacci(n - 1) + fibonacci(n - 2)
  }
}

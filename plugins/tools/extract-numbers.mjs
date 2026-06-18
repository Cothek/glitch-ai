export function handler(input) {
  const matches = input.text.match(/\d+/g);
  return matches ? matches.map(Number) : [];
}
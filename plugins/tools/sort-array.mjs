export function handler(input) {
  const arr = input.array;
  return arr.slice().sort((a, b) => a - b);
}
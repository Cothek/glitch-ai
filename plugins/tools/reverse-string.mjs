export function handler(input) {
  const s = input.string;
  return s.split('').reverse().join('');
}
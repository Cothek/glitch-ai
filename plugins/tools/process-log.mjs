import { handler as extractNumbers } from './extract-numbers.mjs';

export function handler(input) {
  const numbers = extractNumbers({ text: input.log });
  const sum = numbers.reduce((a, b) => a + b, 0);
  return `The sum is ${sum}`;
}
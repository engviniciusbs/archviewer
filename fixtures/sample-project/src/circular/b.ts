import { a, getA } from './a';

export const b = 'Module B';

export function getB(): string {
  return `B depends on A: ${a}`;
}

export function circularCall(): string {
  return getA();
}

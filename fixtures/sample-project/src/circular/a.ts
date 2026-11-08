import { b, getB } from './b';

export const a = 'Module A';

export function getA(): string {
  return `A depends on B: ${b}`;
}

export function circularCall(): string {
  return getB();
}

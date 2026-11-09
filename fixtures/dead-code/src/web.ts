import { helper } from './lib/helper';
import * as ns from './lib/ns';
const m = await import('./lib/lazy');
console.log(ns, m);
export default helper;

import { add } from '@lib/math';
import { helper } from './util.js';
import { nope } from '@lib/nope';
import { missing } from '~/missing';

export const total = add(helper(), nope + missing);

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DepRef } from '@archviewer/core-wasm';
import { importLineMatches, Snippet } from '../../src/components/Snippet';
import type { DirSource } from '../../src/ingest/source';
import { memorySource } from '../../src/ingest/source';

const ref = (path: string): DepRef => ({ id: 1, path, kind: 'static', specifiers: [] });

describe('importLineMatches', () => {
  it.each([
    ["import { b } from './b';", 'src/b.ts'],
    ["import x from '../lib/util.js';", 'lib/util.ts'],
    ['export * from "./ui";', 'src/ui/index.tsx'],
    ["const m = await import('./lazy');", 'src/lazy.ts'],
    ["const fs = require('./fs-helpers');", 'src/fs-helpers.js'],
    ["import { Button } from '@/components/Button';", 'src/components/Button.tsx'],
    ["import React from 'react';", 'react'],
    ["import { jsx } from 'react/jsx-runtime';", 'react'],
    ["import './side-effect';", 'src/side-effect.ts'],
  ])('%s casa com %s', (line, path) => {
    expect(importLineMatches(line, 'src/a.ts', [ref(path)])).toBe(true);
  });

  it.each([
    ["import { b } from './b';", 'src/bb.ts'],
    ["import { b } from './b';", 'other/b.ts'],
    ["import b from 'b';", 'src/b.ts'],
    ["const label = 'src/b.ts';", 'src/b.ts'],
    ['// from ./b', 'src/b.ts'],
    ["import React from 'react-dom';", 'react'],
  ])('%s não casa com %s', (line, path) => {
    expect(importLineMatches(line, 'src/a.ts', [ref(path)])).toBe(false);
  });
});

describe('Snippet', () => {
  it('mostra as primeiras 40 linhas num .graphite e destaca as linhas de import', async () => {
    const lines = ["import { b } from './b';", "import { c } from './c';", ...Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`)];
    const src = memorySource('p', { 'src/a.ts': lines.join('\n') });
    const { container } = render(<Snippet source={src} path="src/a.ts" imports={[ref('src/b.ts')]} />);
    const rows = await screen.findAllByTestId('snippet-line');
    expect(rows).toHaveLength(40);
    expect(container.querySelector('.graphite')).toContainElement(rows[0]!);
    expect(rows[0]).toHaveClass('snippet__line--import');
    expect(rows[1]).not.toHaveClass('snippet__line--import');
    expect(rows[2]).not.toHaveClass('snippet__line--import');
    expect(rows[39]).toHaveTextContent('const x37 = 37;');
  });

  it('uma falha de leitura mostra "Não foi possível ler o arquivo"', async () => {
    const broken: DirSource = {
      name: 'p',
      list: async () => [],
      read: async () => {
        throw new Error('permissão negada');
      },
    };
    render(<Snippet source={broken} path="src/a.ts" imports={[]} />);
    expect(await screen.findByText('Não foi possível ler o arquivo')).toBeInTheDocument();
  });
});

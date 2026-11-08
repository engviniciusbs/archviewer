import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';

describe('App', () => {
  it('mostra o título ArchViewer', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'ArchViewer' })).toBeInTheDocument();
  });
});

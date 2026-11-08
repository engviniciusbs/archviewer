import type { ReactNode } from 'react';
import { Button } from './Button';

export interface CardProps {
  title: string;
  children: ReactNode;
  showAction?: boolean;
}

export function Card({ title, children, showAction = false }: CardProps) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div>{children}</div>
      {showAction && <Button label="Action" variant="secondary" />}
    </div>
  );
}

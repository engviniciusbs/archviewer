import { Button } from './components/Button';
import { Card } from './components/Card';
import { formatDate } from '@/utils/helpers';

export function App() {
  const today = formatDate(new Date());
  return (
    <div>
      <h1>Sample App - {today}</h1>
      <Card title="Welcome">
        <Button label="Click me" />
      </Card>
    </div>
  );
}

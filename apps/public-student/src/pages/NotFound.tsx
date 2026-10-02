import { useNavigate } from 'react-router-dom';
import { KitsNotFound } from '@kits-eos/shared';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <KitsNotFound
      homePath="/"
      onNavigateHome={() => navigate('/')}
      homeLabel="GO TO HOME"
    />
  );
}


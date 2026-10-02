import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCoordinatorSession } from '../utils/coordinatorSession';
import { KitsNotFound } from '@kits-eos/shared';

export function NotFound() {
  const navigate = useNavigate();
  const { role, status, isAllowlisted } = useAuth();
  const coordinatorSession = getCoordinatorSession();

  let homePath = '/';
  if (role === 'ADMIN' && status === 'ACTIVE' && isAllowlisted) {
    homePath = '/admin';
  } else if (coordinatorSession?.session_token) {
    if (coordinatorSession?.coordinator?.coordinator_type === 'PAYMENT_MANAGER') {
      homePath = '/payment-management';
    } else {
      homePath = '/coordinator';
    }
  } else if (role === 'PAYMENT_MANAGER' && status === 'ACTIVE') {
    homePath = '/payment-management';
  } else if (role === 'COORDINATOR' && status === 'ACTIVE') {
    homePath = '/coordinator';
  } else {
    homePath = '/';
  }

  const handleNavigateHome = () => {
    navigate(homePath);
  };

  return (
    <KitsNotFound
      homePath={homePath}
      onNavigateHome={handleNavigateHome}
      homeLabel="GO TO HOME"
    />
  );
}

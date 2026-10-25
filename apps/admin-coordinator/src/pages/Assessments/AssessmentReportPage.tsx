import { useParams, useNavigate } from 'react-router-dom';
import { AssessmentReportView } from '../../components/assessments/AssessmentReportView';
import { getCoordinatorSessionToken, getCoordinatorSession } from '../../utils/coordinatorSession';

export function AssessmentReportPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const coordSession = getCoordinatorSession();
  const coordinatorToken = getCoordinatorSessionToken();
  const isCoordinator =
    coordSession?.coordinator?.coordinator_type === 'ASSESSMENT_COORDINATOR' ||
    (coordSession?.coordinator as any)?.coordinator_type === 'FACULTY' ||
    (coordSession?.coordinator as any)?.coordinator_type === 'ORGANIZER';

  if (!assessmentId) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        Assessment identifier is required to display report analytics.
      </div>
    );
  }

  const handleBack = () => {
    if (isCoordinator) {
      navigate(`/coordinator/assessment-host/${assessmentId}`);
    } else {
      navigate(`/admin/assessments/${assessmentId}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <AssessmentReportView
        assessmentId={assessmentId}
        coordinatorToken={coordinatorToken || undefined}
        onBack={handleBack}
      />
    </div>
  );
}

export default AssessmentReportPage;

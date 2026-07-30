import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import Spinner from '../common/Spinner.jsx';

/**
 * Gate a route behind login (and optionally the 'admin' role).
 * Usage: <ProtectedRoute><AnnotatePage /></ProtectedRoute>
 *        <ProtectedRoute requireAdmin><AdminPage /></ProtectedRoute>
 */
function ProtectedRoute({ children, requireAdmin = false }) {
  const { profile, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-900">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/annotate" replace />;
  }

  return children;
}

export default ProtectedRoute;

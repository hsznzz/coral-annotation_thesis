import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, isAdmin, logout } = useAuth();

  const isActive = (path) => location.pathname === path;

  const baseLink = 'px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors';
  const activeClasses = 'bg-slate-800 text-emerald-400';
  const inactiveClasses = 'text-slate-300 hover:bg-slate-800 hover:text-emerald-300';

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav className="border-b border-slate-800 bg-slate-900/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <Link to="/" className="text-sm sm:text-base font-semibold text-emerald-400">
          Coral Bleaching Annotation
        </Link>
        <div className="flex items-center gap-2">
          {profile && (
            <>
              <Link
                to="/dashboard"
                className={`${baseLink} ${isActive('/dashboard') ? activeClasses : inactiveClasses}`}
              >
                Dashboard
              </Link>
              <Link
                to="/annotate"
                className={`${baseLink} ${isActive('/annotate') ? activeClasses : inactiveClasses}`}
              >
                Annotate
              </Link>
              <Link
                to="/history"
                className={`${baseLink} ${isActive('/history') ? activeClasses : inactiveClasses}`}
              >
                History
              </Link>
            </>
          )}
          {isAdmin && (
            <Link to="/admin" className={`${baseLink} ${isActive('/admin') ? activeClasses : inactiveClasses}`}>
              Admin
            </Link>
          )}
          {profile ? (
            <>
              <button onClick={handleLogout} className={`${baseLink} ${inactiveClasses}`}>
                Log out
              </button>
            </>
          ) : (
            <Link to="/" className={`${baseLink} ${isActive('/') ? activeClasses : inactiveClasses}`}>
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;

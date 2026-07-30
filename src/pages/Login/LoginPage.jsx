import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../api/services/authService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../../components/common/Button.jsx';

function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { profile } = useAuth();

  if (profile) {
    navigate('/dashboard');
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    if (mode === 'signup' && (!firstName.trim() || !lastName.trim())) {
      setError('Please enter your first and last name.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        await authService.signUp(email, password, { firstName, lastName });
        setInfo('Account created. Check your email to confirm it, then sign in.');
        setMode('login');
      } else {
        await authService.login(email, password);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center gap-10">
        {/* Left side: branding / description */}
        <div className="flex-1 text-center lg:text-left space-y-4">
          <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 border border-emerald-500/30">
            Coral Bleaching Detection Phase 1
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
            Log in to the coral
            <span className="block text-emerald-400">bleaching annotation tool</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-xl">
            Each expert annotates coral patches across four classes: Living
            Coral (LC), Partially Bleached (PB), Dead Coral (DC), and Dead
            Coral with Algae (DCA).
          </p>
        </div>

        {/* Right side: login card */}
        <div className="flex-1 w-full max-w-md">
          <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur">
            <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-center">
              {mode === 'login' ? 'Expert login' : 'Create an account'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mb-6 text-center">
              {mode === 'login'
                ? 'Use your email to continue annotating your patch set.'
                : 'New annotator accounts start with standard access; an admin can promote you later.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs sm:text-sm font-medium text-left" htmlFor="firstName">
                      First name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      placeholder="Jane"
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs sm:text-sm font-medium text-left" htmlFor="lastName">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      placeholder="Cruz"
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs sm:text-sm font-medium text-left" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="you@example.com"
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs sm:text-sm font-medium text-left" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="Enter your password"
                  disabled={loading}
                />
              </div>

              {error && <p className="text-xs sm:text-sm text-red-400">{error}</p>}
              {info && <p className="text-xs sm:text-sm text-emerald-400">{info}</p>}

              <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create account'}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
                setInfo('');
                setFirstName('');
                setLastName('');
              }}
              className="mt-4 w-full text-center text-xs sm:text-sm text-slate-400 hover:text-emerald-400"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;

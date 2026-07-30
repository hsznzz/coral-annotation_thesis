import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import './App.css';

import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import Layout from './components/layout/Layout.jsx';
import LoginPage from './pages/Login/LoginPage.jsx';
import DashboardPage from './pages/Dashboard/DashboardPage.jsx';
import HistoryPage from './pages/History/HistoryPage.jsx';
import AnnotatePage from './pages/Annotate/AnnotatePage.jsx';
import AdminPage from './pages/Admin/AdminPage.jsx';
import NotFound from './pages/NotFound/NotFound.jsx';

function AppRoutes() {
  const location = useLocation();
  // The annotation workspace is a fullscreen, immersive canvas — no navbar.
  const isFullscreenPage = location.pathname === '/annotate';

  if (isFullscreenPage) {
    return (
      <div className="h-full w-full bg-slate-900 text-slate-100">
        <Routes>
          <Route
            path="/annotate"
            element={
              <ProtectedRoute>
                <AnnotatePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-slate-900 text-slate-100">
      <Layout>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

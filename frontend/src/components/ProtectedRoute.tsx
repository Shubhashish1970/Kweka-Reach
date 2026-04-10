import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { isAuthenticated, user, activeRole, loading } = useAuth();
  const location = useLocation();

  // Show loading screen while checking authentication
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto mb-4 text-lime-600" size={32} />
          <p className="text-sm text-slate-600 font-medium">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password-required') {
    return <Navigate to="/change-password-required" replace />;
  }

  // Use activeRole for permission check (falls back to primary role if not set)
  const currentRole = activeRole || user.role;

  if (allowedRoles && !allowedRoles.includes(currentRole)) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-2xl font-black text-slate-800 mb-2">Access Denied</h1>
          <p className="text-sm text-slate-600">You don't have permission to access this page with your current role.</p>
          <p className="text-xs text-slate-400 mt-2">Current role: {currentRole}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;


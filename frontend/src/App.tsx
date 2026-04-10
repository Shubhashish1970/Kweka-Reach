import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import ForceChangePassword from './components/ForceChangePassword';
import ModuleSelection from './components/ModuleSelection';
import AgentWorkspace from './components/AgentWorkspace';
import TaskList from './components/TaskList';
import AdminDashboardContainer from './components/AdminDashboard/AdminDashboardContainer';
import TeamLeadDashboardContainer from './components/TeamLeadDashboard/TeamLeadDashboardContainer';

// Component that routes based on user's active role
// All users now land on Module Selection first, then route to workspace based on active role
const AppContent: React.FC = () => {
  // All roles now see Module Selection first to choose their role (if multi-role) and workspace
  return <ModuleSelection />;
};

// EMS Workspace - routes to correct dashboard based on active role
const EMSWorkspace: React.FC = () => {
  const { activeRole, user } = useAuth();
  const currentRole = activeRole || user?.role;

  // Route based on active role
  switch (currentRole) {
    case 'mis_admin':
      return <AdminDashboardContainer />;
    case 'team_lead':
      return <TeamLeadDashboardContainer />;
    case 'cc_agent':
    default:
      return <AgentWorkspace />;
  }
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
              path="/change-password-required"
              element={
                <ProtectedRoute>
                  <ForceChangePassword />
                </ProtectedRoute>
              }
            />
            
            {/* Protected routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppContent />
                </ProtectedRoute>
              }
            />
            
            {/* Module workspace routes - route to correct dashboard based on active role */}
            <Route
              path="/workspace/ems"
              element={
                <ProtectedRoute>
                  <EMSWorkspace />
                </ProtectedRoute>
              }
            />
            
            {/* Redirect unknown routes to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;

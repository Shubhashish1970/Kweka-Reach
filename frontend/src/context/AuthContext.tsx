import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI } from '../services/api.js';

export type UserRole = 'cc_agent' | 'team_lead' | 'mis_admin' | 'core_sales_head' | 'marketing_head';

interface User {
  id: string;
  name: string;
  email: string;
  role: string; // Primary/default role
  roles: string[]; // All available roles
  employeeId: string;
  languageCapabilities: string[];
  assignedTerritories: string[];
  teamLeadId?: string;
  isActive: boolean;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: User | null;
  activeRole: string | null; // Currently active role for this session
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  switchRole: (role: string) => void; // Switch active role
  isAuthenticated: boolean;
  hasMultipleRoles: boolean; // Convenience check
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      // Always start with loading true and user null
      setUser(null);
      setActiveRole(null);
      setLoading(true);

      const token = localStorage.getItem('authToken');
      const storedUser = localStorage.getItem('user');
      const storedActiveRole = localStorage.getItem('activeRole');

      if (token && storedUser) {
        try {
          // Verify token is still valid by fetching current user with timeout
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Auth check timeout')), 5000)
          );
          
          const response = await Promise.race([
            authAPI.getCurrentUser(),
            timeoutPromise,
          ]) as any;

          if (response?.success && response?.data?.user) {
            const fetchedUser = response.data.user;
            // Ensure roles array exists (backward compatibility)
            if (!fetchedUser.roles || fetchedUser.roles.length === 0) {
              fetchedUser.roles = [fetchedUser.role];
            }
            if (fetchedUser._id && !fetchedUser.id) {
              fetchedUser.id = String(fetchedUser._id);
            }
            setUser(fetchedUser);
            
            // Restore active role from storage or use primary role
            const validActiveRole = storedActiveRole && fetchedUser.roles.includes(storedActiveRole)
              ? storedActiveRole
              : fetchedUser.role;
            setActiveRole(validActiveRole);
            localStorage.setItem('activeRole', validActiveRole);
          } else {
            // Token invalid, clear storage
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            localStorage.removeItem('activeRole');
            setUser(null);
            setActiveRole(null);
          }
        } catch (error) {
          // Token invalid or network error, clear storage
          console.error('Auth check failed:', error);
          localStorage.removeItem('authToken');
          localStorage.removeItem('user');
          localStorage.removeItem('activeRole');
          setUser(null);
          setActiveRole(null);
        }
      } else {
        // No token or user in storage, ensure user is null
        setUser(null);
        setActiveRole(null);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authAPI.login(email, password);
    if (response.success) {
      const loggedInUser = response.data.user;
      // Ensure roles array exists (backward compatibility)
      if (!loggedInUser.roles || loggedInUser.roles.length === 0) {
        loggedInUser.roles = [loggedInUser.role];
      }
      if (loggedInUser._id && !loggedInUser.id) {
        loggedInUser.id = String(loggedInUser._id);
      }
      setUser(loggedInUser);
      
      // Set active role to primary role on login
      setActiveRole(loggedInUser.role);
      localStorage.setItem('activeRole', loggedInUser.role);
    } else {
      throw new Error('Login failed');
    }
  };

  const logout = async () => {
    await authAPI.logout();
    localStorage.removeItem('activeRole');
    setUser(null);
    setActiveRole(null);
  };

  const refreshUser = async () => {
    const response: any = await authAPI.getCurrentUser();
    if (response?.success && response?.data?.user) {
      const u = response.data.user;
      if (!u.roles || u.roles.length === 0) {
        u.roles = [u.role];
      }
      if (u._id && !u.id) {
        u.id = String(u._id);
      }
      setUser(u);
      localStorage.setItem('user', JSON.stringify(u));
    }
  };

  const switchRole = (role: string) => {
    if (user && user.roles.includes(role)) {
      setActiveRole(role);
      localStorage.setItem('activeRole', role);
    }
  };

  const value: AuthContextType = {
    user,
    activeRole,
    loading,
    login,
    logout,
    refreshUser,
    switchRole,
    isAuthenticated: !!user,
    hasMultipleRoles: !!user && user.roles && user.roles.length > 1,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, Eye, EyeOff, Phone, Users, BarChart3, Leaf, LogIn, X } from 'lucide-react';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      const raw = localStorage.getItem('user');
      const stored = raw ? JSON.parse(raw) : null;
      if (stored?.mustChangePassword) {
        navigate('/change-password-required', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Full-Screen Background Image - Smiling Indian Farmer */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url('/images/farmer-hero.png')`,
        }}
      />
      {/* Gradient Overlay - lighter to show the farmer more clearly */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-900/70 via-slate-900/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-transparent to-slate-900/20" />

      {/* Top Bar with Sign In Button */}
      <div className="relative z-20">
        <div className="flex items-center justify-between p-6 lg:p-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-lime-400 rounded-xl flex items-center justify-center shadow-lg">
              <Leaf size={28} className="text-slate-900" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Kweka Reach</h1>
              <p className="text-xs text-slate-300 font-medium">Farmer Engagement Platform</p>
            </div>
          </div>

          {/* Sign In Button & Dropdown Container */}
          <div className="relative">
            <button
              onClick={() => setShowLoginPanel(!showLoginPanel)}
              className="flex items-center gap-2 px-6 py-3 bg-lime-400 hover:bg-lime-500 text-slate-900 rounded-full font-bold text-sm uppercase tracking-wider shadow-lg hover:shadow-xl transition-all"
            >
              <LogIn size={18} />
              Sign In
            </button>

            {/* Login Panel - Drops down below button */}
            <div 
              className={`absolute right-0 top-full mt-3 w-[380px] transition-all duration-300 ease-out ${
                showLoginPanel 
                  ? 'opacity-100 translate-y-0 pointer-events-auto' 
                  : 'opacity-0 -translate-y-4 pointer-events-none'
              }`}
            >
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="bg-slate-900 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-lime-400 rounded-lg flex items-center justify-center">
                      <Leaf size={18} className="text-slate-900" />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm">Welcome back</h3>
                      <p className="text-[11px] text-slate-400">Sign in to continue</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowLoginPanel(false)}
                    className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Form */}
                <div className="p-5">
                  {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium">
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="email" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                        Email Address
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full min-h-12 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 transition-all"
                        placeholder="Enter your email"
                      />
                    </div>

                    <div>
                      <label htmlFor="password" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="w-full px-3.5 py-3 pr-11 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-lime-400 transition-all text-sm font-medium min-h-12"
                          placeholder="Enter your password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div className="text-right">
                      <Link
                        to="/forgot-password"
                        className="text-xs text-slate-500 hover:text-lime-600 font-medium transition-colors"
                      >
                        Forgot Password?
                      </Link>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          Signing In...
                        </>
                      ) : (
                        'Sign In'
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Bottom aligned */}
      <div className="relative z-10 min-h-screen flex flex-col justify-end pb-12 px-6 lg:px-12">
        <div className="max-w-4xl">
          {/* Tagline */}
          <p className="text-lime-400 text-sm font-bold uppercase tracking-widest mb-4">
            Call Centre Management
          </p>
          
          {/* Main Headline */}
          <h2 className="text-4xl lg:text-6xl font-black text-white leading-tight mb-6">
            Connecting Farmers,<br />
            <span className="text-lime-400">Empowering Growth</span>
          </h2>
          
          {/* Description */}
          <p className="text-slate-300 text-lg lg:text-xl leading-relaxed mb-10 max-w-2xl">
            Streamline your farmer outreach with intelligent call management, 
            real-time analytics, and seamless activity tracking.
          </p>

          {/* Features Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-10">
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
              <div className="w-10 h-10 bg-lime-400/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Phone size={20} className="text-lime-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Smart Calling</p>
                <p className="text-slate-400 text-xs">Efficient outreach</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
              <div className="w-10 h-10 bg-lime-400/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Users size={20} className="text-lime-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Farmer Connect</p>
                <p className="text-slate-400 text-xs">Build relationships</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
              <div className="w-10 h-10 bg-lime-400/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <BarChart3 size={20} className="text-lime-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Live Analytics</p>
                <p className="text-slate-400 text-xs">Real-time insights</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
              <div className="w-10 h-10 bg-lime-400/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Leaf size={20} className="text-lime-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Agri Focus</p>
                <p className="text-slate-400 text-xs">Crop & product tracking</p>
              </div>
            </div>
          </div>

          {/* KPI Stats */}
          <div className="flex flex-wrap items-center gap-6 lg:gap-10">
            <div>
              <p className="text-4xl lg:text-5xl font-black text-white">10K+</p>
              <p className="text-slate-400 text-sm">Farmers Reached</p>
            </div>
            <div className="w-px h-14 bg-slate-600 hidden lg:block" />
            <div>
              <p className="text-4xl lg:text-5xl font-black text-white">95%</p>
              <p className="text-slate-400 text-sm">Satisfaction Rate</p>
            </div>
            <div className="w-px h-14 bg-slate-600 hidden lg:block" />
            <div>
              <p className="text-4xl lg:text-5xl font-black text-white">50+</p>
              <p className="text-slate-400 text-sm">Active Territories</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-white/10">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Kweka Reach. All rights reserved.
          </p>
        </div>
      </div>

      {/* Click outside to close login panel */}
      {showLoginPanel && (
        <div 
          className="fixed inset-0 z-10"
          onClick={() => setShowLoginPanel(false)}
        />
      )}
    </div>
  );
};

export default Login;

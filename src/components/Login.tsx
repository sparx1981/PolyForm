import React, { useEffect, useState } from 'react';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { motion } from 'motion/react';
import { LogIn, Mail, Lock, Chrome, Loader2, X } from 'lucide-react';
import { recordLoginActivity } from '../lib/loginActivity';

interface LoginProps {
  /** Shown over the landing page: a close button and Escape take you back to it. */
  onClose?: () => void;
  /** A line under the heading, e.g. why sign-in is needed. */
  note?: string;
}

export default function Login({ onClose, note }: LoginProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      recordLoginActivity({ email: result.user.email || '', success: true, method: 'google' });
    } catch (err: any) {
      setError(err.message);
      recordLoginActivity({ email, success: false, method: 'google', reason: err.code || err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      recordLoginActivity({ email, success: true, method: 'password' });
    } catch (err: any) {
      setError(err.message);
      recordLoginActivity({ email, success: false, method: 'password', reason: err.code || err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto p-4 ${onClose ? 'bg-polyform-dark-blue/40 backdrop-blur-sm' : 'bg-gray-50'}`}
      onClick={onClose ? e => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        role={onClose ? 'dialog' : undefined}
        aria-modal={onClose ? true : undefined}
        aria-labelledby="login-title"
        className="relative w-full max-w-md p-8 bg-white rounded-2xl shadow-modus-4 border border-gray-100"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        )}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-polyform-blue rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-polyform-blue/20">
            <LogIn className="text-white" size={32} />
          </div>
          <h1 id="login-title" className="text-2xl font-bold text-gray-900">Welcome to PolyForm</h1>
          <p className="text-gray-500 mt-2">{note ?? 'Sign in to start modeling'}</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-gray-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Chrome size={20} className="text-red-500" />}
            Continue with Google
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink mx-4 text-gray-400 text-sm uppercase tracking-wider">or</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-polyform-blue focus:border-transparent outline-none transition-all"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-polyform-blue focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div id="login-error" role="alert" aria-live="assertive" className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-polyform-blue text-white rounded-lg font-semibold hover:bg-polyform-dark-blue transition-all shadow-md shadow-polyform-blue/20 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin mx-auto" size={20} />
              ) : (
                isRegistering ? 'Create Account' : 'Sign In'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            {isRegistering ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-polyform-blue font-semibold hover:underline"
            >
              {isRegistering ? 'Sign In' : 'Create one'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

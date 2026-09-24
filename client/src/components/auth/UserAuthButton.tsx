import React, { useState, useRef, useEffect } from 'react';
import { User, signInWithGoogle, signOutUser } from '../../services/firebase';
import { LogOut, User as UserIcon, CheckCircle2 } from 'lucide-react';

interface Props {
  user: User | null;
  onStatusMessage?: (msg: string) => void;
  onSignOut?: () => void;
}

export const UserAuthButton: React.FC<Props> = ({ user, onStatusMessage, onSignOut }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const u = await signInWithGoogle();
      if (onStatusMessage) {
        onStatusMessage(`Welcome to the party, ${u.displayName?.split(' ')[0] || 'Singer'}! 🎤`);
      }
    } catch (err: any) {
      console.warn('Google sign in error:', err);
      // Ignore user-cancelled popup errors
      if (err.code !== 'auth/popup-closed-by-user') {
        alert(`Sign in could not be completed: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (onSignOut) {
        onSignOut();
      }
      await signOutUser();
      setIsOpen(false);
      if (onStatusMessage) {
        onStatusMessage('Signed out successfully.');
      }
    } catch (err) {
      console.warn('Sign out failed:', err);
    }
  };

  // 1. Unauthenticated State: Sleek Google Sign-In Button
  if (!user) {
    return (
      <button
        onClick={handleLogin}
        disabled={loading}
        className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[#222224] hover:bg-[#2c2c30] text-[#e0e0e0] hover:text-white border border-[#38383c] hover:border-blue-500/50 shadow-sm transition active:scale-95 cursor-pointer flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-mono font-semibold"
        title="Sign in with Google to save lyrics and join the party list"
      >
        {loading ? (
          <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
            />
          </svg>
        )}
        <span className="hidden xs:inline">Sign In</span>
      </button>
    );
  }

  // 2. Authenticated State: Google Avatar & Profile Dropdown
  const firstName = user.displayName?.split(' ')[0] || 'Singer';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 p-1 sm:px-2 sm:py-1 rounded-lg bg-[#222224] hover:bg-[#2d2d30] border border-[#38383c] hover:border-[#4f4f56] transition cursor-pointer shadow-sm select-none"
        title={`Signed in as ${user.email}`}
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || 'User'}
            className="w-5 h-5 sm:w-6 sm:h-6 rounded-full object-cover border border-blue-400/60"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">
            {firstName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-[11px] sm:text-xs font-mono font-bold text-white hidden sm:inline max-w-[85px] truncate">
          {firstName}
        </span>
      </button>

      {/* Profile Popup Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[#1b1b1b] border border-[#333333] shadow-2xl z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150 font-sans">
          {/* User info */}
          <div className="flex items-center gap-3 pb-3 border-b border-[#2d2d2d]">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-10 h-10 rounded-full object-cover border border-blue-500/50"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                <UserIcon size={18} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.displayName || 'Party Singer'}</p>
              <p className="text-[11px] text-[#888888] truncate font-mono">{user.email}</p>
              <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono text-emerald-400 font-semibold">
                <CheckCircle2 size={11} /> Party Member
              </div>
            </div>
          </div>

          {/* Action links */}
          <div className="pt-2">
            <button
              onClick={handleLogout}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2 transition cursor-pointer"
            >
              <LogOut size={13} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

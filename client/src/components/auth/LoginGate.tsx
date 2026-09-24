import React, { useState } from 'react';
import { signInWithGoogle } from '../../services/firebase';
import { Mic2, Lock, Music2, Sliders, ShieldCheck } from 'lucide-react';

interface Props {
  onSuccess?: () => void;
}

export const LoginGate: React.FC<Props> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.warn('Sign in error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setErrorMsg(err.message || 'Unable to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-[#101012] text-[#cccccc] flex flex-col justify-between items-center px-3 sm:px-4 py-3 sm:py-6 relative overflow-y-auto select-none">
      {/* Background ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] sm:w-[500px] h-[340px] sm:h-[500px] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-indigo-500/5 rounded-full blur-[90px] pointer-events-none" />

      {/* Top Branding Bar */}
      <header className="w-full max-w-4xl flex items-center justify-between z-10">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/30 border border-blue-400/40">
            <Mic2 size={18} />
          </div>
          <div>
            <span className="font-mono font-bold text-white tracking-wider text-sm sm:text-base flex items-center gap-1.5">
              SUPAJUKA <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold">2.0</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1b1b1f] border border-[#2d2d34] text-[11px] font-mono text-[#8e8e96]">
          <Lock size={12} className="text-amber-400" />
          <span>Members Only</span>
        </div>
      </header>

      {/* Central Login Card */}
      <main className="w-full max-w-md my-auto py-6 z-10 flex flex-col items-center">
        <div className="w-full bg-[#17171a]/95 backdrop-blur-xl border border-[#2a2a32] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/80 flex flex-col items-center text-center">
          
          {/* Glowing Animated Icon */}
          <div className="relative mb-5">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-xl shadow-blue-500/30 border border-blue-400/30">
              <Mic2 size={36} className="text-white drop-shadow-md" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-black border-2 border-[#17171a]">
              <ShieldCheck size={13} className="text-white stroke-[2.5]" />
            </div>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight mb-2">
            Private Party Station
          </h2>
          <p className="text-xs sm:text-sm text-[#94949e] mb-6 max-w-xs leading-relaxed font-sans">
            Sign in with Google to unlock bit-perfect lossless karaoke, 30+ tracks, live vocal balance, and synced lyrics.
          </p>

          {/* Error Message */}
          {errorMsg && (
            <div className="w-full mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-mono text-left">
              {errorMsg}
            </div>
          )}

          {/* Google Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm transition-all duration-150 active:scale-[0.98] shadow-lg shadow-white/10 hover:shadow-white/20 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mb-5"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
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
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {/* Feature highlights */}
          <div className="w-full pt-4 border-t border-[#26262e] grid grid-cols-2 gap-2 text-left">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[#121214] border border-[#202026]">
              <Music2 size={13} className="text-blue-400 flex-shrink-0" />
              <span className="text-[11px] font-mono text-[#a0a0ab] truncate">Studio Stems</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[#121214] border border-[#202026]">
              <Sliders size={13} className="text-amber-400 flex-shrink-0" />
              <span className="text-[11px] font-mono text-[#a0a0ab] truncate">WASM Key Shift</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-md text-center text-[10px] font-mono text-[#666672] z-10">
        SupaJuka 2.0 • Lossless Jukebox & Karaoke • Private Stage
      </footer>
    </div>
  );
};

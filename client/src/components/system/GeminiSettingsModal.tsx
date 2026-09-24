import React, { useState, useEffect } from 'react';
import { X, Sparkles, CheckCircle2, AlertCircle, ExternalLink, Key, Eye, EyeOff } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const GeminiSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [hasExistingKey, setHasExistingKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Load existing key from localStorage or server
    const local = localStorage.getItem('supajuka_gemini_key') || '';
    if (local) {
      setApiKey(local);
      setHasExistingKey(true);
    }

    fetch('/api/audio/settings/gemini-key')
      .then((r) => r.json())
      .then((data) => {
        if (data.hasKey) {
          setHasExistingKey(true);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveAndTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    const trimmed = apiKey.trim();
    localStorage.setItem('supajuka_gemini_key', trimmed);

    try {
      const res = await fetch('/api/audio/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });

      const data = await res.json();
      if (data.success && data.testSuccess) {
        setTestResult({
          success: true,
          message: 'Gemini API connection verified! Ground-truth lyrics enabled.',
        });
        setHasExistingKey(true);
      } else if (trimmed === '') {
        setTestResult({
          success: true,
          message: 'Key cleared. SupaJuka will use LRCLIB free database.',
        });
        setHasExistingKey(false);
      } else {
        setTestResult({
          success: false,
          message: data.testError || 'Invalid API key or network error.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to connect to server.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleClear = async () => {
    setApiKey('');
    localStorage.removeItem('supajuka_gemini_key');
    await fetch('/api/audio/settings/gemini-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: '' }),
    });
    setHasExistingKey(false);
    setTestResult({
      success: true,
      message: 'Cleared. Using free LRCLIB database.',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#2d2d2d] flex items-center justify-between bg-[#181818]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#252526] border border-[#333333] flex items-center justify-center text-amber-400">
              <Sparkles size={15} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-tight">Official Lyrics Alignment</h2>
              <p className="text-[11px] text-[#858585] font-mono">Gemini AI Ground-Truth Syllable Engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-white hover:bg-[#252526] transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-lg bg-[#141414] border border-[#2d2d2d] text-xs text-[#858585] leading-relaxed font-mono">
            <p className="mb-2">
              <strong className="text-amber-400">// WHY OFFICIAL LYRICS:</strong> Whisper can sometimes misinterpret guitar noise or drum transients as false words.
            </p>
            <p>
              When a Gemini API key is provided, SupaJuka fetches canonical lyrics to constrain acoustic alignment, ensuring the bouncing ball snaps to genuine vocal transients.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-[#cccccc] flex items-center gap-1.5 font-mono">
                <Key size={13} className="text-amber-400" /> Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 hover:underline font-mono text-[11px]"
              >
                Get free key from AI Studio <ExternalLink size={10} />
              </a>
            </div>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3.5 py-2 bg-[#141414] border border-[#2d2d2d] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-2 text-[#858585] hover:text-white"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs font-mono flex items-center gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              {testResult.success ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Fallback Notice */}
          <div className="text-[11px] text-[#666666] font-mono">
            ℹ️ <strong className="text-[#858585]">ZERO-KEY FALLBACK:</strong> If no Gemini key is provided, SupaJuka uses <strong>LRCLIB</strong> (free open-source synced lyrics database) without requiring credentials.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[#2d2d2d] bg-[#181818] flex items-center justify-between">
          <div>
            {hasExistingKey && (
              <button
                onClick={handleClear}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer font-mono"
              >
                Remove Key
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono text-[#858585] hover:text-white hover:bg-[#252526] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAndTest}
              disabled={isTesting}
              className="px-4 py-1.5 rounded-lg text-xs font-mono font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm border border-blue-500/40 transition disabled:opacity-50 cursor-pointer"
            >
              {isTesting ? 'VERIFYING...' : 'SAVE & VERIFY'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

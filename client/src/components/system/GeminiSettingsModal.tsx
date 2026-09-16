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
      <div className="w-full max-w-lg bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-fuchsia-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-['Outfit']">Official Lyrics AI Pre-Stage</h2>
              <p className="text-xs text-slate-400">Gemini Ground-Truth Verification</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
            <p className="mb-2">
              <strong className="text-fuchsia-300">Why Official Lyrics?</strong> Whisper can sometimes transcribe background guitar distortion or drum transients as false words (e.g. interpreting guitar hits as &quot;hear&quot; before the phrase starts).
            </p>
            <p>
              When a Gemini API key is provided, SupaJuka fetches canonical ground-truth lyrics to constrain Faster-Whisper, ensuring the bouncing ball hits true vocal transients.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Key size={13} className="text-fuchsia-400" /> Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-fuchsia-400 hover:text-fuchsia-300 flex items-center gap-1 hover:underline"
              >
                Get free key from Google AI Studio <ExternalLink size={11} />
              </a>
            </div>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-fuchsia-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Fallback Notice */}
          <div className="text-[11px] text-slate-500">
            ℹ️ <strong className="text-slate-400">Zero-Key Fallback:</strong> If no Gemini API key is entered, SupaJuka automatically uses <strong>LRCLIB</strong> (free open-source community lyrics database) without requiring any credentials.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
          <div>
            {hasExistingKey && (
              <button
                onClick={handleClear}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
              >
                Remove Key
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAndTest}
              disabled={isTesting}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white shadow-md shadow-fuchsia-600/30 transition disabled:opacity-50 cursor-pointer"
            >
              {isTesting ? 'Verifying...' : 'Save & Verify Key'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

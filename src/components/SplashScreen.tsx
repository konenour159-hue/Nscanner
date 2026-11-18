import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface SplashScreenProps {
  isReady: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isReady,
  errorMessage,
  onRetry,
  onComplete,
}) => {
  const [minDelayElapsed, setMinDelayElapsed] = useState(false);
  const [fading, setFading] = useState(false);

  // Brief non-blocking entrance pause (~380ms) so the brand lockup settles smoothly
  useEffect(() => {
    const timer = setTimeout(() => setMinDelayElapsed(true), 380);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isReady || !minDelayElapsed || errorMessage) return;
    setFading(true);
    const doneTimer = setTimeout(() => onComplete(), 220);
    return () => clearTimeout(doneTimer);
  }, [isReady, minDelayElapsed, errorMessage, onComplete]);

  return (
    <div
      role="status"
      aria-label="Loading NScanner"
      className={`fixed inset-0 z-50 bg-white flex flex-col items-center justify-center px-6 transition-opacity duration-200 select-none pt-safe pb-safe ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center gap-4 ns-animate-enter">
        <img
          src="/assets/aistudio/image_20c39404.png"
          alt="NScanner logo"
          className="w-16 h-16 rounded-full object-cover ns-logo-violet"
        />

        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1B22]">NScanner</h1>
          <p className="text-xs font-medium text-[#666672] tracking-wide mt-1">
            Scan. Manage. Analyze.
          </p>
        </div>

        {errorMessage ? (
          <div className="mt-3 max-w-xs text-center space-y-3">
            <p className="text-xs text-[#666672] leading-relaxed">{errorMessage}</p>
            <div className="flex items-center justify-center gap-2">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}
              <button
                onClick={onComplete}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-[#E6E6EB] hover:border-[#7C3AED] text-[#1C1B22] text-xs font-medium transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="w-24 h-0.5 bg-[#DDD6FE] rounded-full overflow-hidden mt-2" aria-hidden="true">
            <div
              className={`h-full bg-[#7C3AED] rounded-full transition-all duration-300 ${
                isReady && minDelayElapsed ? 'w-full' : 'w-1/2'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
};

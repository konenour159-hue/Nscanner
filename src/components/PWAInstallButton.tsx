import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'drawer' | 'settings';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'drawer' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'drawer'
            ? 'w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer'
            : 'min-h-[40px] px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install NScanner App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'drawer'
              ? 'w-full min-h-[42px] px-3 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#EDE9FE] text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer'
              : 'min-h-[40px] px-3.5 py-2 rounded-lg bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#EDE9FE] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer'
          }
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Install on iPhone / iPad</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1B22]/45 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Install NScanner on iOS"
              className="w-full max-w-sm rounded-xl bg-white border border-[#E6E6EB] p-5 shadow-xl space-y-3 text-left"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#1C1B22]">Install on iPhone / iPad</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close guide"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#666672] hover:text-[#1C1B22] hover:bg-[#FAFAFC]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-[#666672] space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  Tap the <strong className="text-[#1C1B22]">Share</strong> button in the Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong className="text-[#1C1B22]">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-[#1C1B22]">Add</strong> to launch NScanner full-screen.
                </li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[40px] rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 left-4 z-40 flex items-center gap-2 rounded-lg bg-[#1C1B22] border border-[#343240] px-3 py-2 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>Offline Mode · Camera, PDF tools &amp; local library ready</span>
    </div>
  );
};

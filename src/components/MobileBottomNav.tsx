import React from 'react';
import { Home, FileText, Camera, BarChart3 } from 'lucide-react';
import { AppScreen } from '../types/scanner';

interface MobileBottomNavProps {
  activeScreen: AppScreen;
  onSelectScreen: (screen: AppScreen) => void;
  onStartScan: () => void;
  contained?: boolean;
  disabled?: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeScreen,
  onSelectScreen,
  onStartScan,
  contained = false,
  disabled = false,
}) => {
  const isLibraryActive =
    activeScreen === 'documents' ||
    activeScreen === 'recent' ||
    activeScreen === 'favorites' ||
    activeScreen === 'categories' ||
    activeScreen === 'trash';

  const isAnalyticsActive =
    activeScreen === 'analytics' || activeScreen === 'storage';

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className={`${
        contained
          ? 'sticky bottom-0 left-0 right-0 z-30'
          : 'fixed bottom-0 left-0 right-0 z-40 lg:hidden'
      } bg-white/95 backdrop-blur-md border-t border-[#E6E6EB] pb-safe select-none`}
    >
      <div className="grid grid-cols-4 items-center h-16 px-1 max-w-lg mx-auto">
        {/* 1. Home */}
        <button
          onClick={() => !disabled && onSelectScreen('home')}
          disabled={disabled}
          aria-current={activeScreen === 'home' ? 'page' : undefined}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${
            activeScreen === 'home'
              ? 'text-[#7C3AED]'
              : 'text-[#1C1B22] hover:text-[#7C3AED]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span
            className={`text-[11px] leading-tight ${
              activeScreen === 'home' ? 'font-semibold' : 'font-medium text-[#666672]'
            }`}
          >
            Home
          </span>
        </button>

        {/* 2. Documents */}
        <button
          onClick={() => !disabled && onSelectScreen('documents')}
          disabled={disabled}
          aria-current={isLibraryActive ? 'page' : undefined}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${
            isLibraryActive
              ? 'text-[#7C3AED]'
              : 'text-[#1C1B22] hover:text-[#7C3AED]'
          }`}
        >
          <FileText className="w-5 h-5" />
          <span
            className={`text-[11px] leading-tight ${
              isLibraryActive ? 'font-semibold' : 'font-medium text-[#666672]'
            }`}
          >
            Documents
          </span>
        </button>

        {/* 3. Scan (Balanced distinctive primary accent) */}
        <button
          onClick={() => !disabled && onStartScan()}
          disabled={disabled}
          className="min-h-[44px] flex flex-col items-center justify-center gap-0.5 group focus-visible:outline-2 focus-visible:outline-[#7C3AED]"
          aria-label="Scan Document"
        >
          <span className="w-11 h-7 rounded-full bg-[#7C3AED] group-hover:bg-[#6D28D9] group-active:scale-95 text-white flex items-center justify-center transition-all">
            <Camera className="w-4 h-4" />
          </span>
          <span className="text-[11px] leading-tight font-semibold text-[#7C3AED]">
            Scan
          </span>
        </button>

        {/* 4. Analytics */}
        <button
          onClick={() => !disabled && onSelectScreen('analytics')}
          disabled={disabled}
          aria-current={isAnalyticsActive ? 'page' : undefined}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${
            isAnalyticsActive
              ? 'text-[#7C3AED]'
              : 'text-[#1C1B22] hover:text-[#7C3AED]'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span
            className={`text-[11px] leading-tight ${
              isAnalyticsActive ? 'font-semibold' : 'font-medium text-[#666672]'
            }`}
          >
            Analytics
          </span>
        </button>
      </div>
    </nav>
  );
};

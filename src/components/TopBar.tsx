import React from 'react';
import { Menu, Search, FolderPlus, Trash2 } from 'lucide-react';
import { AnalyticsTimeframe, AppScreen } from '../types/scanner';

interface TopBarProps {
  activeScreen: AppScreen;
  screenTitle: string;
  onToggleMenu: () => void;
  isMenuOpen: boolean;
  disabled?: boolean;
  // Contextual actions
  onFocusSearch?: () => void;
  onOpenFolderManager?: () => void;
  trashedCount?: number;
  onEmptyTrash?: () => void;
  analyticsTimeframe?: AnalyticsTimeframe;
  onChangeTimeframe?: (tf: AnalyticsTimeframe) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeScreen,
  screenTitle,
  onToggleMenu,
  isMenuOpen,
  disabled = false,
  onFocusSearch,
  onOpenFolderManager,
  trashedCount = 0,
  onEmptyTrash,
  analyticsTimeframe = '30d',
  onChangeTimeframe,
}) => {
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);

  React.useEffect(() => {
    setConfirmEmpty(false);
  }, [activeScreen, trashedCount]);

  React.useEffect(() => {
    if (!confirmEmpty) return;
    const t = setTimeout(() => setConfirmEmpty(false), 3500);
    return () => clearTimeout(t);
  }, [confirmEmpty]);

  const showSearchAction =
    activeScreen === 'documents' ||
    activeScreen === 'recent' ||
    activeScreen === 'favorites';

  return (
    <header className="h-14 px-3 sm:px-5 border-b border-[#E6E6EB] bg-white sticky top-0 z-30 pt-safe flex items-center justify-between gap-3 shrink-0">
      {/* Left: Consistent Hamburger Menu + Active Screen Title */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={() => !disabled && onToggleMenu()}
          disabled={disabled}
          aria-label={isMenuOpen ? 'Toggle navigation menu' : 'Open navigation menu'}
          aria-expanded={isMenuOpen}
          className="w-11 h-11 -ml-1.5 rounded-lg flex items-center justify-center text-[#1C1B22] hover:bg-[#FAFAFC] hover:text-[#7C3AED] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#7C3AED]"
        >
          <Menu className="w-5 h-5" />
        </button>

        <h1 className="text-base font-bold tracking-tight text-[#1C1B22] truncate">
          {screenTitle}
        </h1>
      </div>

      {/* Right: Single Contextual Screen Action */}
      <div className="flex items-center shrink-0">
        {showSearchAction && onFocusSearch && (
          <button
            onClick={onFocusSearch}
            className="min-h-[40px] px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium text-[#1C1B22] hover:bg-[#F5F3FF] hover:text-[#7C3AED] transition-colors whitespace-nowrap"
            aria-label="Search documents"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Search</span>
          </button>
        )}

        {activeScreen === 'categories' && onOpenFolderManager && (
          <button
            onClick={onOpenFolderManager}
            className="min-h-[40px] px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Folder</span>
          </button>
        )}

        {activeScreen === 'trash' && trashedCount > 0 && onEmptyTrash && (
          confirmEmpty ? (
            <button
              onClick={() => {
                setConfirmEmpty(false);
                onEmptyTrash();
              }}
              className="min-h-[40px] px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold bg-[#DC2626] text-white transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              <span>Confirm ({trashedCount})</span>
            </button>
          ) : (
            <button
              onClick={() => setConfirmEmpty(true)}
              className="min-h-[40px] px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-[#DC2626] hover:bg-red-50 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              <span>Empty Trash</span>
            </button>
          )
        )}

        {activeScreen === 'analytics' && onChangeTimeframe && (
          <div
            role="group"
            aria-label="Analytics timeframe"
            className="inline-flex items-center p-0.5 bg-[#FAFAFC] border border-[#E6E6EB] rounded-lg text-[11px]"
          >
            {(
              [
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: '12m', label: '12M' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => onChangeTimeframe(opt.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                  analyticsTimeframe === opt.id
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-[#666672] hover:text-[#1C1B22]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
};

import React, { useEffect, useRef } from 'react';
import {
  Home,
  Camera,
  FileText,
  Clock,
  Star,
  FolderKanban,
  Trash2,
  BarChart3,
  HardDrive,
  Settings,
  HelpCircle,
  Info,
  X,
} from 'lucide-react';
import { AppScreen } from '../types/scanner';

interface NavEntry {
  id: AppScreen | 'scan';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface NavGroup {
  heading: string;
  items: NavEntry[];
}

interface NavigationDrawerContentProps {
  activeScreen: AppScreen;
  trashedCount: number;
  onSelectScreen: (screen: AppScreen) => void;
  onStartScan: () => void;
  onCloseDrawer?: () => void;
  showCloseButton?: boolean;
}

const DrawerBody: React.FC<NavigationDrawerContentProps> = ({
  activeScreen,
  trashedCount,
  onSelectScreen,
  onStartScan,
  onCloseDrawer,
  showCloseButton = false,
}) => {
  const groups: NavGroup[] = [
    {
      heading: 'MAIN',
      items: [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'scan', label: 'Scan Document', icon: Camera },
        { id: 'documents', label: 'My Documents', icon: FileText },
        { id: 'recent', label: 'Recent Documents', icon: Clock },
      ],
    },
    {
      heading: 'ORGANIZATION',
      items: [
        { id: 'favorites', label: 'Favorites', icon: Star },
        { id: 'categories', label: 'Categories', icon: FolderKanban },
        {
          id: 'trash',
          label: 'Trash',
          icon: Trash2,
          badge: trashedCount > 0 ? trashedCount : undefined,
        },
      ],
    },
    {
      heading: 'INSIGHTS',
      items: [
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'storage', label: 'Storage Overview', icon: HardDrive },
      ],
    },
    {
      heading: 'PREFERENCES',
      items: [
        { id: 'settings', label: 'Settings', icon: Settings },
        { id: 'help', label: 'Help & Support', icon: HelpCircle },
        { id: 'about', label: 'About NScanner', icon: Info },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full bg-white text-[#1C1B22] select-none">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#E6E6EB]">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/assets/aistudio/image_20c39404.png"
            alt="NScanner"
            className="w-9 h-9 rounded-full object-cover shrink-0 ns-logo-violet"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-[#1C1B22] truncate">
              NScanner
            </div>
            <div className="text-[11px] text-[#666672] truncate">
              Scan. Manage. Analyze.
            </div>
          </div>
        </div>

        {showCloseButton && onCloseDrawer && (
          <button
            onClick={onCloseDrawer}
            className="w-10 h-10 -mr-2 rounded-lg flex items-center justify-center text-[#666672] hover:text-[#1C1B22] hover:bg-[#FAFAFC] transition-colors"
            aria-label="Close navigation menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <nav
        aria-label="Primary sections"
        className="flex-1 overflow-y-auto px-3 py-3 space-y-4"
      >
        {groups.map((group, groupIdx) => (
          <div
            key={group.heading}
            className={groupIdx > 0 ? 'pt-3 border-t border-[#E6E6EB]' : ''}
          >
            <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider text-[#666672]">
              {group.heading}
            </div>

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id !== 'scan' && activeScreen === item.id;
                const isScanItem = item.id === 'scan';

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (isScanItem) {
                        onStartScan();
                      } else {
                        onSelectScreen(item.id as AppScreen);
                      }
                      onCloseDrawer?.();
                    }}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-lg flex items-center justify-between text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${
                      isActive
                        ? 'bg-[#F5F3FF] text-[#7C3AED] font-semibold'
                        : isScanItem
                        ? 'text-[#1C1B22] font-medium hover:bg-[#F5F3FF] hover:text-[#7C3AED]'
                        : 'text-[#1C1B22] font-normal hover:bg-[#FAFAFC]'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-[18px] h-[18px] shrink-0 ${
                          isActive || isScanItem ? 'text-[#7C3AED]' : 'text-[#666672]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>

                    <span className="flex items-center gap-2 shrink-0">
                      {item.badge !== undefined && (
                        <span className="text-[11px] font-mono tabular-nums text-[#666672]">
                          {item.badge}
                        </span>
                      )}
                      {isActive && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
};

interface SlideDrawerProps {
  isOpen: boolean;
  contained?: boolean;
  activeScreen: AppScreen;
  trashedCount: number;
  onSelectScreen: (screen: AppScreen) => void;
  onStartScan: () => void;
  onClose: () => void;
}

export const SlideNavigationDrawer: React.FC<SlideDrawerProps> = ({
  isOpen,
  contained = false,
  activeScreen,
  trashedCount,
  onSelectScreen,
  onStartScan,
  onClose,
}) => {
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
  }

  function handleTouchMove(e: React.TouchEvent) {
    touchCurrentX.current = e.touches[0].clientX;
  }

  function handleTouchEnd() {
    if (touchStartX.current !== null && touchCurrentX.current !== null) {
      const deltaX = touchCurrentX.current - touchStartX.current;
      // Swipe left >= 56px closes the left-side drawer cleanly
      if (deltaX < -56) {
        onClose();
      }
    }
    touchStartX.current = null;
    touchCurrentX.current = null;
  }

  return (
    <div
      className={`${
        contained ? 'absolute inset-0 z-40' : 'fixed inset-0 z-50 lg:hidden'
      } transition-opacity duration-200 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Tap-outside backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-[#1C1B22]/35 backdrop-blur-[1px]"
      />

      {/* Slide-in Drawer Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="NScanner navigation drawer"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className={`relative w-[276px] max-w-[82%] h-full bg-white border-r border-[#E6E6EB] shadow-xl pt-safe pb-safe transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <DrawerBody
          activeScreen={activeScreen}
          trashedCount={trashedCount}
          onSelectScreen={onSelectScreen}
          onStartScan={onStartScan}
          onCloseDrawer={onClose}
          showCloseButton={true}
        />
      </div>
    </div>
  );
};

interface PersistentSidebarProps {
  isOpen: boolean;
  activeScreen: AppScreen;
  trashedCount: number;
  onSelectScreen: (screen: AppScreen) => void;
  onStartScan: () => void;
}

export const PersistentSidebar: React.FC<PersistentSidebarProps> = ({
  isOpen,
  activeScreen,
  trashedCount,
  onSelectScreen,
  onStartScan,
}) => {
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Sidebar navigation"
      className="hidden lg:block w-64 shrink-0 border-r border-[#E6E6EB] bg-white h-[calc(100vh-3.5rem)] sticky top-14 overflow-hidden"
    >
      <DrawerBody
        activeScreen={activeScreen}
        trashedCount={trashedCount}
        onSelectScreen={onSelectScreen}
        onStartScan={onStartScan}
        showCloseButton={false}
      />
    </aside>
  );
};

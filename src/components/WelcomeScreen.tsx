import React from 'react';
import { ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
  onGetStarted: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onGetStarted }) => {
  return (
    <div className="min-h-[100dvh] bg-white text-[#1C1B22] flex flex-col justify-between pt-safe pb-safe">
      {/* Header: Brand Logo + Wordmark */}
      <header
        className="w-full max-w-5xl mx-auto px-5 sm:px-8 pt-5 sm:pt-7 pb-2 flex items-center justify-between ns-animate-enter"
        style={{ animationDelay: '0ms' }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/image_20c39404.png"
            alt="NScanner logo"
            className="w-9 h-9 rounded-full object-cover shrink-0 ns-logo-violet"
          />
          <span className="text-base font-bold tracking-tight text-[#1C1B22] whitespace-nowrap">
            NScanner
          </span>
        </div>

        <span className="text-xs font-medium text-[#666672] whitespace-nowrap">
          Scan. Manage. Analyze.
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 py-4 sm:py-8 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-center">
          {/* Scanning Visual Showcase (Order 1 on mobile below header, right column on desktop) */}
          <div
            className="lg:col-span-6 lg:order-2 flex items-center justify-center ns-animate-enter"
            style={{ animationDelay: '70ms' }}
          >
            <div className="relative w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[400px] aspect-[4/3.6] max-h-[34vh] sm:max-h-[38vh] lg:max-h-[420px] bg-[#FAFAFC] border border-[#E6E6EB] rounded-xl p-4 sm:p-6 flex items-center justify-center overflow-hidden">
              {/* Subtle Calibration Grid */}
              <div
                aria-hidden="true"
                className="absolute inset-4 border border-[#E6E6EB]/70 rounded-lg pointer-events-none"
              />

              {/* Realistic Paper Document Sheet */}
              <div className="relative w-[78%] h-[88%] bg-white border border-[#E6E6EB] rounded-sm shadow-[0_6px_24px_rgba(28,27,34,0.06)] p-4 sm:p-5 flex flex-col justify-between -rotate-1">
                {/* Document Header Band */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="h-2.5 w-20 bg-[#1C1B22] rounded-[2px]" />
                    <div className="h-2 w-12 bg-[#DDD6FE] rounded-[2px]" />
                  </div>
                  <div className="h-1.5 w-28 bg-[#E6E6EB] rounded-[2px]" />
                </div>

                {/* Structured Document Lines */}
                <div className="space-y-2 my-2">
                  <div className="h-px w-full bg-[#E6E6EB]" />
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-7 h-1.5 bg-[#D1D1D9] rounded-[2px]" />
                    <div className="col-span-2 h-1.5 bg-[#E6E6EB] rounded-[2px]" />
                    <div className="col-span-3 h-1.5 bg-[#A78BFA] rounded-[2px]" />
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6 h-1.5 bg-[#D1D1D9] rounded-[2px]" />
                    <div className="col-span-3 h-1.5 bg-[#E6E6EB] rounded-[2px]" />
                    <div className="col-span-3 h-1.5 bg-[#D1D1D9] rounded-[2px]" />
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-8 h-1.5 bg-[#D1D1D9] rounded-[2px]" />
                    <div className="col-span-1 h-1.5 bg-[#E6E6EB] rounded-[2px]" />
                    <div className="col-span-3 h-1.5 bg-[#D1D1D9] rounded-[2px]" />
                  </div>
                  <div className="h-px w-full bg-[#E6E6EB] mt-1" />
                </div>

                {/* Summary & Authentic Pen Signature Mark */}
                <div className="flex items-end justify-between pt-1">
                  <div className="space-y-1">
                    <div className="h-1.5 w-14 bg-[#E6E6EB] rounded-[2px]" />
                    <div className="h-2 w-16 bg-[#7C3AED] rounded-[2px]" />
                  </div>

                  <svg
                    viewBox="0 0 64 22"
                    className="w-14 h-5 text-[#1C1B22]"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 16 C10 4, 15 18, 22 10 C27 4, 31 17, 38 11 C43 7, 48 15, 60 8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                {/* Precision Optical Scanning Frame Overlay */}
                <div
                  aria-hidden="true"
                  className="absolute -inset-2 pointer-events-none"
                >
                  {/* Subtle Projection Tint */}
                  <div className="absolute inset-0 bg-[#7C3AED]/[0.04] border border-[#7C3AED]/30 rounded-[3px]" />

                  {/* Corner Reticle Brackets */}
                  <span className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#7C3AED]" />
                  <span className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#7C3AED]" />
                  <span className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#7C3AED]" />
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#7C3AED]" />

                  {/* Active Violet Scan Line Indicator */}
                  <div className="absolute inset-x-0 top-0 h-full overflow-hidden">
                    <div className="ns-scan-line w-full">
                      <div className="h-[2px] w-full bg-[#7C3AED] shadow-[0_0_8px_rgba(124,58,237,0.55)]" />
                      <div className="h-4 w-full bg-gradient-to-b from-[#7C3AED]/15 to-transparent" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Headline, Description & Primary Action */}
          <div className="lg:col-span-6 lg:order-1 flex flex-col items-center lg:items-start text-center lg:text-left space-y-5">
            <div
              className="space-y-3 max-w-md ns-animate-enter"
              style={{ animationDelay: '130ms' }}
            >
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#1C1B22] [text-wrap:balance] leading-[1.15]">
                Every document, under control.
              </h1>

              <p className="text-sm sm:text-base text-[#666672] leading-relaxed">
                Turn paper documents into clear, organized digital files.
              </p>
            </div>

            <div
              className="w-full sm:w-auto pt-1 ns-animate-enter"
              style={{ animationDelay: '190ms' }}
            >
              <button
                type="button"
                onClick={onGetStarted}
                className="w-full sm:w-auto min-h-[48px] px-8 py-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] active:bg-[#5B21B6] active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] cursor-pointer"
              >
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Discreet Brand Credit */}
      <footer
        className="w-full max-w-5xl mx-auto px-5 sm:px-8 pb-5 pt-2 text-center lg:text-left ns-animate-enter"
        style={{ animationDelay: '230ms' }}
      >
        <p className="text-[11px] text-[#666672]">
          Designed by Koné Nourdine for public utility.
        </p>
      </footer>
    </div>
  );
};

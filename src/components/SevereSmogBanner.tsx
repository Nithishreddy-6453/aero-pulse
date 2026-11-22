import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CityAirProfile } from '../types/aeropulse';
import { isSevereSmogEmergency } from '../utils/impactCalc';

interface SevereSmogBannerProps {
  city: CityAirProfile;
  checkedIds: string[];
  onToggleCheck: (id: string) => void;
  onAlertFamily: () => void;
}

const PROTOCOL_CHECKS = [
  { id: 'seal-windows', label: 'Seal Windows' },
  { id: 'purifier-turbo', label: 'Purifier Turbo' },
  { id: 'cancel-outdoor-play', label: 'Cancel Outdoor Play' },
] as const;

export function SevereSmogBanner({
  city,
  checkedIds,
  onToggleCheck,
  onAlertFamily,
}: SevereSmogBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Strictly hidden unless the active city's live AQI is 300 or higher
  const shouldShow = isSevereSmogEmergency(city.aqi, city.isLive);
  const completedCount = PROTOCOL_CHECKS.filter((c) => checkedIds.includes(c.id)).length;

  return (
    <AnimatePresence initial={false}>
      {shouldShow && (
        <motion.div
          key="severe-smog-banner"
          initial={{ opacity: 0, y: -12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.985 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          role="alert"
          aria-live="polite"
          className="relative z-20 mx-auto max-w-[1320px] px-4 pt-4 sm:px-6 lg:px-8"
        >
          <div className="overflow-hidden rounded-3xl border border-rose-200/80 bg-rose-50/85 px-4 py-3 shadow-[0_12px_32px_-12px_rgba(255,59,48,0.22),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Pulsing Coral SEVERE SMOG PROTOCOL badge + live AQI */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#FF3B30] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-white shadow-xs">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                  SEVERE SMOG PROTOCOL
                </span>

                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-rose-950 tabular-nums-strict">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#FF3B30]" aria-hidden="true" />
                  <span>
                    {city.name}: {city.aqi} AQI
                  </span>
                  <span className="text-rose-700/75">· {completedCount}/3 active</span>
                </span>
              </div>

              {/* Right: 1-Click Alert Family + Collapse Chevron */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onAlertFamily}
                  className="apple-press inline-flex h-8 items-center gap-1.5 rounded-full bg-[#FF3B30] px-3.5 text-[12px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,59,48,0.65)] hover:bg-[#E03127]"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Alert Family</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => !prev)}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? 'Expand severe smog protocol' : 'Collapse severe smog protocol'}
                  className="apple-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200/80 bg-white/80 text-rose-800 hover:bg-white"
                >
                  {collapsed ? (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Collapsible 3 Mini-Check Pills Row */}
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  key="protocol-checks"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rose-200/60 pt-2.5">
                    {PROTOCOL_CHECKS.map((item) => {
                      const checked = checkedIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onToggleCheck(item.id)}
                          aria-pressed={checked}
                          className={`apple-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                            checked
                              ? 'border-[#34C759]/45 bg-[#34C759]/14 text-[#15803D]'
                              : 'border-rose-200/90 bg-white/85 text-rose-950 hover:border-rose-300 hover:bg-white'
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                              checked
                                ? 'bg-[#34C759] text-white'
                                : 'border border-rose-300 bg-rose-50/70 text-transparent'
                            }`}
                          >
                            <Check className="h-2.5 w-2.5 stroke-[3]" aria-hidden="true" />
                          </span>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

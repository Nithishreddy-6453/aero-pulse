import { useEffect, useState } from 'react';
import { CityAirProfile } from '../../types/aeropulse';

export interface SmogClockTimelineProps {
  city: CityAirProfile;
}

export function SmogClockTimeline({ city }: SmogClockTimelineProps) {
  const [hoveredSlotIdx, setHoveredSlotIdx] = useState<number | null>(null);

  useEffect(() => {
    setHoveredSlotIdx(null);
  }, [city.id]);

  const timeline = city.hourlyTimeline;
  const hasTimeline = timeline.length > 0;

  // Point the floating tooltip directly to the lowest-AQI 2-hour safe window
  const safeMidPct = hasTimeline
    ? (((city.safeStartIdx + city.safeEndIdx) / 2 + 0.5) / timeline.length) * 100
    : 50;

  const activeSlot =
    hasTimeline && hoveredSlotIdx !== null ? timeline[hoveredSlotIdx] : null;
  const activeSlotPct =
    hasTimeline && hoveredSlotIdx !== null
      ? ((hoveredSlotIdx + 0.5) / timeline.length) * 100
      : safeMidPct;

  return (
    <div className="rounded-2xl bg-slate-50/85 p-4 ring-1 ring-slate-200/70 sm:p-5">
      <div className="mb-9 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="font-semibold text-[#0F172A]">
          24-Hour Visual Smog Clock (Live Open-Meteo Hourly US AQI)
        </span>
        <div className="flex items-center gap-3 text-[#64748B]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#FF3B30]" />
            Poor / Severe
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#FF9500]" />
            Moderate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#34C759]" />
            Best 2h Window
          </span>
        </div>
      </div>

      {hasTimeline ? (
        <div className="relative" onMouseLeave={() => setHoveredSlotIdx(null)}>
          {/* Floating Tooltip anchored to actual lowest-AQI 2-hour window */}
          <div
            className="pointer-events-none absolute -top-9 z-20 -translate-x-1/2 transition-all duration-200 ease-out"
            style={{ left: `${Math.min(82, Math.max(18, activeSlotPct))}%` }}
          >
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold shadow-md whitespace-nowrap ${
                activeSlot
                  ? activeSlot.status === 'safe'
                    ? 'bg-[#34C759] text-white'
                    : activeSlot.status === 'peak'
                      ? 'bg-[#FF3B30] text-white'
                      : 'bg-[#0F172A] text-white'
                  : 'bg-[#34C759] text-white shadow-[0_6px_18px_-4px_rgba(52,199,89,0.55)]'
              }`}
            >
              {activeSlot ? (
                <span className="tabular-nums-strict">
                  {activeSlot.hourLabel} • {activeSlot.aqi} AQI • PM2.5 {activeSlot.pm25}
                </span>
              ) : (
                <span>Safe Outdoor Window: {city.safeWindowLabel}</span>
              )}
            </div>
          </div>

          {/* Segmented Pill Bar */}
          <div className="flex h-4 w-full items-center gap-[3px] rounded-full bg-slate-200/70 p-[3px]">
            {timeline.map((slot, idx) => {
              const isHovered = hoveredSlotIdx === idx;
              const isBest2h = idx === city.safeStartIdx || idx === city.safeEndIdx;
              const barColor = isBest2h
                ? 'bg-[#34C759] shadow-[0_0_12px_rgba(52,199,89,0.55)]'
                : slot.status === 'safe'
                  ? 'bg-[#34C759]/80'
                  : slot.status === 'peak'
                    ? 'bg-[#FF3B30]'
                    : 'bg-[#FF9500]/80';
              return (
                <button
                  key={slot.hourLabel}
                  type="button"
                  onMouseEnter={() => setHoveredSlotIdx(idx)}
                  onFocus={() => setHoveredSlotIdx(idx)}
                  onClick={() => setHoveredSlotIdx(idx)}
                  aria-label={`${slot.hourLabel}: ${slot.aqi} AQI, PM2.5 ${slot.pm25}`}
                  className={`h-full flex-1 rounded-full transition-transform duration-150 ${barColor} ${
                    isHovered ? 'scale-y-125 brightness-105' : ''
                  }`}
                />
              );
            })}
          </div>

          {/* Time Axis Labels */}
          <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold text-[#64748B] tabular-nums-strict">
            <span>6 AM</span>
            <span>10 AM</span>
            <span>2 PM</span>
            <span>6 PM</span>
            <span>11 PM</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-4 w-full animate-pulse rounded-full bg-slate-200/80" />
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#94A3B8]">
            <span>6 AM</span>
            <span>10 AM</span>
            <span>2 PM</span>
            <span>6 PM</span>
            <span>11 PM</span>
          </div>
        </div>
      )}
    </div>
  );
}

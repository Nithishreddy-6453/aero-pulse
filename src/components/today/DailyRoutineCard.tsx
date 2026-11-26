import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CityAirProfile, TodayAdvisoryPayload } from '../../types/aeropulse';
import { CircularToggle } from '../CircularToggle';

type RoutinePeriod = 'Morning' | 'Afternoon' | 'Evening';

function getActiveRoutinePeriod(hour24: number): RoutinePeriod {
  if (hour24 < 12) return 'Morning';
  if (hour24 < 17) return 'Afternoon';
  return 'Evening';
}

export interface DailyRoutineCardProps {
  city: CityAirProfile;
  advisory: TodayAdvisoryPayload | null;
  isLoadingAdvisory: boolean;
  advisoryError: string | null;
  onRetryAdvisory: () => void;
  onToggleRoutine: (id: string) => void;
}

export function DailyRoutineCard({
  city,
  advisory,
  isLoadingAdvisory,
  advisoryError,
  onRetryAdvisory,
  onToggleRoutine,
}: DailyRoutineCardProps) {
  const [currentPeriod, setCurrentPeriod] = useState<RoutinePeriod>(() =>
    getActiveRoutinePeriod(new Date().getHours())
  );

  // Keep active routine time slot aligned with the user's local clock
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentPeriod(getActiveRoutinePeriod(new Date().getHours()));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleRoutines = useMemo(() => advisory?.routines ?? [], [advisory]);
  const completedRoutines = useMemo(
    () => visibleRoutines.filter((r) => r.completed).length,
    [visibleRoutines]
  );

  return (
    <section className="glass-card glass-card-lift rounded-3xl p-6 lg:col-span-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-[#0F172A]">
            Low-Emission Daily Routine
          </h2>
          <p className="text-[13px] text-[#64748B]">
            Gemini shield for {city.name} • {city.isLive ? `${city.aqi} AQI` : 'Live sync'}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-[#34C759]/12 px-3 py-1 text-[12px] font-bold text-[#15803D] tabular-nums-strict">
          {completedRoutines}/{visibleRoutines.length} Done
        </span>
      </div>

      {isLoadingAdvisory && visibleRoutines.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-20 animate-pulse rounded-2xl border border-slate-200/70 bg-slate-100/70"
            />
          ))}
        </div>
      ) : advisoryError && visibleRoutines.length === 0 ? (
        <div className="rounded-2xl border border-[#FF3B30]/20 bg-[#FF3B30]/[0.05] p-5 text-center">
          <p className="text-[13px] font-semibold text-[#B91C1C]">{advisoryError}</p>
          <button
            type="button"
            onClick={onRetryAdvisory}
            className="apple-press mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-4 py-2 text-[12px] font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry Gemini Routine
          </button>
        </div>
      ) : (
        <div
          className={`space-y-4 transition-opacity duration-200 ${
            isLoadingAdvisory ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {(['Morning', 'Afternoon', 'Evening'] as const).map((period) => {
            const group = visibleRoutines.filter((r) => r.period === period);
            if (group.length === 0) return null;
            const isNowPeriod = period === currentPeriod;
            return (
              <div
                key={period}
                className={`space-y-2 transition-all duration-200 ${
                  isNowPeriod
                    ? 'rounded-2xl bg-white/75 p-3 ring-1 ring-slate-200/85 shadow-[0_10px_28px_-14px_rgba(15,23,42,0.16)]'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`text-[11px] font-bold uppercase tracking-[0.06em] ${
                      isNowPeriod ? 'text-[#0F172A]' : 'text-[#64748B]'
                    }`}
                  >
                    {period}
                  </div>
                  {isNowPeriod && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#34C759]/14 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#15803D] ring-1 ring-[#34C759]/25">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#34C759]" aria-hidden="true" />
                      NOW
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {group.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => onToggleRoutine(item.id)}
                      className={`apple-press flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                        item.completed
                          ? 'border-slate-200/70 bg-slate-50/75'
                          : isNowPeriod
                            ? 'border-slate-200/90 bg-white shadow-2xs hover:border-slate-300'
                            : 'border-slate-200/80 bg-white/90 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <CircularToggle
                          checked={item.completed}
                          onChange={() => onToggleRoutine(item.id)}
                          ariaLabel={`Toggle ${item.title}`}
                        />
                        <div className="min-w-0">
                          <p
                            className={`text-[14px] font-semibold leading-snug transition-colors ${
                              item.completed ? 'text-[#64748B] line-through' : 'text-[#0F172A]'
                            }`}
                          >
                            {item.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded-full bg-[#34C759]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#15803D] tabular-nums-strict">
                              {item.impactPill}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
                              {/^\s*why:/i.test(item.whyPill) ? item.whyPill : `Why: ${item.whyPill}`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { HabitSwap } from '../../types/aeropulse';
import { calculateHabitSimulatorImpact } from '../../utils/impactCalc';
import { AnimatedNumber } from '../AnimatedNumber';

export type HabitSimulatorImpact = ReturnType<typeof calculateHabitSimulatorImpact>;

export interface HabitRingsCardProps {
  habits: HabitSwap[];
  scale: 'family' | 'colony';
  habitMetrics: HabitSimulatorImpact;
  onChangeScale: (scale: 'family' | 'colony') => void;
  onToggleHabit: (id: string) => void;
  onChangeHabitDays: (id: string, days: number) => void;
  colonyRippleSlot?: ReactNode;
}

export function HabitRingsCard({
  habits,
  scale,
  habitMetrics,
  onChangeScale,
  onToggleHabit,
  onChangeHabitDays,
  colonyRippleSlot,
}: HabitRingsCardProps) {
  const {
    activeCount: activeHabitsCount,
    lungShieldPct,
    displayCleanHours,
    displayCo2Kg,
    lungRingProgress,
    cleanHoursProgress,
    co2Progress,
  } = habitMetrics;

  const rings = [
    {
      label: 'Lung Shield',
      radius: 86,
      stroke: '#FF3B30',
      track: 'rgba(255, 59, 48, 0.14)',
      progress: lungRingProgress,
    },
    {
      label: 'Clean Air Hours',
      radius: 66,
      stroke: '#34C759',
      track: 'rgba(52, 199, 89, 0.15)',
      progress: cleanHoursProgress,
    },
    {
      label: 'CO₂ Saved',
      radius: 46,
      stroke: '#00C7BE',
      track: 'rgba(0, 199, 190, 0.15)',
      progress: co2Progress,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
      {/* LEFT 7 COLS: Habit Swaps */}
      <section className="glass-card rounded-3xl p-6 lg:col-span-7">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-[#0F172A]">
              Choice-to-Impact Habit Swaps
            </h2>
            <p className="text-[13px] text-[#64748B]">
              Toggle habits & weekly frequency to watch your rings respond
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-[#0F172A] tabular-nums-strict">
            {activeHabitsCount}/4 Active
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {habits.map((habit) => {
            const sliderPct = ((habit.daysPerWeek - 1) / 4) * 100;
            return (
              <div
                key={habit.id}
                className={`glass-card-lift flex flex-col justify-between rounded-2xl border p-4 transition-all ${
                  habit.enabled
                    ? 'border-[#34C759]/35 bg-white/95 shadow-xs'
                    : 'border-slate-200/80 bg-slate-50/75 opacity-85'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-[15px] font-bold text-[#0F172A]">
                        {habit.title}
                      </h3>
                      <p className="mt-0.5 text-[12px] leading-snug text-[#64748B]">
                        {habit.subtitle}
                      </p>
                    </div>

                    {/* iOS Pill Switch Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={habit.enabled}
                      aria-label={`Toggle ${habit.title}`}
                      onClick={() => onToggleHabit(habit.id)}
                      className={`apple-press relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                        habit.enabled ? 'bg-[#34C759]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                          habit.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="mt-2.5">
                    <span className="inline-flex items-center rounded-full bg-[#00C7BE]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#0F766E] tabular-nums-strict">
                      {habit.tag}
                    </span>
                  </div>
                </div>

                {/* 1-5 days/wk Apple Range Slider */}
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-[#64748B]">Frequency</span>
                    <span className="tabular-nums-strict font-bold text-[#0F172A]">
                      {habit.daysPerWeek} {habit.daysPerWeek === 1 ? 'day' : 'days'}/wk
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    disabled={!habit.enabled}
                    value={habit.daysPerWeek}
                    onChange={(e) => onChangeHabitDays(habit.id, Number(e.target.value))}
                    aria-label={`${habit.title} days per week`}
                    className="apple-slider w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                    style={{
                      background: habit.enabled
                        ? `linear-gradient(to right, #34C759 0%, #34C759 ${sliderPct}%, #E2E8F0 ${sliderPct}%, #E2E8F0 100%)`
                        : '#E2E8F0',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* RIGHT 5 COLS: Apple Health Activity Rings */}
      <section className="glass-card flex flex-col justify-between rounded-3xl p-6 lg:col-span-5">
        <div>
          {/* Segmented Switch: My Family | 500 Homes in Colony */}
          <div
            role="tablist"
            aria-label="Impact scale"
            className="flex items-center justify-between rounded-full bg-slate-200/60 p-1"
          >
            {(
              [
                { id: 'family', label: 'My Family' },
                { id: 'colony', label: '500 Homes in Colony' },
              ] as const
            ).map((opt) => {
              const active = scale === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeScale(opt.id)}
                  className={`apple-press relative flex-1 rounded-full py-1.5 text-center text-[12px] font-semibold whitespace-nowrap ${
                    active ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="impactScalePill"
                      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                      className="absolute inset-0 rounded-full bg-white shadow-xs"
                    />
                  )}
                  <span className="relative z-10">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Centerpiece: 3 Glowing Concentric SVG Activity Rings */}
          <div className="my-5 flex flex-col items-center">
            <div className="relative flex h-52 w-52 items-center justify-center">
              <svg
                viewBox="0 0 210 210"
                className="h-full w-full -rotate-90 overflow-visible"
                role="img"
                aria-label="Apple Health style concentric impact rings for Lung Shield, Clean Air Hours, and CO2 Saved"
              >
                <defs>
                  <filter id="ringGlowCoral" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow
                      dx="0"
                      dy="0"
                      stdDeviation="3.5"
                      floodColor="#FF3B30"
                      floodOpacity="0.45"
                    />
                  </filter>
                  <filter id="ringGlowEmerald" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow
                      dx="0"
                      dy="0"
                      stdDeviation="3.5"
                      floodColor="#34C759"
                      floodOpacity="0.45"
                    />
                  </filter>
                  <filter id="ringGlowCyan" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow
                      dx="0"
                      dy="0"
                      stdDeviation="3.5"
                      floodColor="#00C7BE"
                      floodOpacity="0.45"
                    />
                  </filter>
                </defs>

                {rings.map((ring, idx) => {
                  const circumference = 2 * Math.PI * ring.radius;
                  const dashOffset = circumference * (1 - ring.progress);
                  const filterId =
                    idx === 0
                      ? 'url(#ringGlowCoral)'
                      : idx === 1
                        ? 'url(#ringGlowEmerald)'
                        : 'url(#ringGlowCyan)';
                  return (
                    <g key={ring.label}>
                      <circle
                        cx="105"
                        cy="105"
                        r={ring.radius}
                        fill="none"
                        stroke={ring.track}
                        strokeWidth="14"
                      />
                      <circle
                        cx="105"
                        cy="105"
                        r={ring.radius}
                        fill="none"
                        stroke={ring.stroke}
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        filter={filterId}
                        style={{
                          transition: 'stroke-dashoffset 620ms cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Center Score */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <AnimatedNumber
                  value={lungShieldPct}
                  suffix="%"
                  className="font-display text-[22px] font-extrabold leading-none text-[#0F172A]"
                />
                <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                  Shield
                </span>
              </div>
            </div>

            {/* Crisp 3-Metric Legend Row */}
            <div className="mt-2 grid w-full grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-[#FF3B30]/8 p-2.5 ring-1 ring-[#FF3B30]/20">
                <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-[#C81E1E]">
                  Lung Shield
                </div>
                <div className="mt-1 font-display text-[17px] font-extrabold text-[#0F172A]">
                  <AnimatedNumber value={lungShieldPct} suffix="%" />
                </div>
              </div>

              <div className="rounded-2xl bg-[#34C759]/10 p-2.5 ring-1 ring-[#34C759]/25">
                <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-[#15803D]">
                  Clean Hrs/wk
                </div>
                <div className="mt-1 font-display text-[17px] font-extrabold text-[#0F172A]">
                  <AnimatedNumber value={displayCleanHours} suffix="h" />
                </div>
              </div>

              <div className="rounded-2xl bg-[#00C7BE]/10 p-2.5 ring-1 ring-[#00C7BE]/25">
                <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-[#0F766E]">
                  CO₂ Saved
                </div>
                <div className="mt-1 font-display text-[17px] font-extrabold text-[#0F172A]">
                  <AnimatedNumber
                    value={displayCo2Kg}
                    decimals={scale === 'colony' ? 0 : 1}
                    suffix=" kg"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {colonyRippleSlot}
      </section>
    </div>
  );
}

import { FormEvent, useMemo, useState } from 'react';
import { Check, Clock, Plus, Route, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { calculateErrandBundleImpact, sanitizeUserInput } from '../../utils/impactCalc';

const DEFAULT_ERRAND_CHIPS = ['Groceries', 'Pharmacy', 'School Pickup', 'Gym / Bank'] as const;

export interface ErrandBundlerCardProps {
  safeWindowLabel: string;
  selectedErrands: string[];
  customErrands: string[];
  onToggleErrand: (errand: string) => void;
  onAddCustomErrand: (errand: string) => void;
  onRemoveCustomErrand: (errand: string) => void;
}

export function ErrandBundlerCard({
  safeWindowLabel,
  selectedErrands,
  customErrands,
  onToggleErrand,
  onAddCustomErrand,
  onRemoveCustomErrand,
}: ErrandBundlerCardProps) {
  const [customStopInput, setCustomStopInput] = useState('');

  const allErrandChips = useMemo(
    () => [...DEFAULT_ERRAND_CHIPS, ...customErrands],
    [customErrands]
  );
  const errandBundle = useMemo(
    () => calculateErrandBundleImpact(selectedErrands),
    [selectedErrands]
  );

  const bundledCount = errandBundle.stopCount;
  const coldStartsAvoided = errandBundle.coldStartsAvoided;
  const bundledCo2SavedKg = errandBundle.co2SavedKg;
  const bundledPm25DropPct = errandBundle.roadsidePm25ReductionPct;

  const handleAddStopSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = sanitizeUserInput(customStopInput, 28);
    if (!trimmed) return;
    onAddCustomErrand(trimmed);
    setCustomStopInput('');
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-2xs backdrop-blur-xl">
      <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#34C759]/14 text-[#1E8E3E]">
            <Route className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-[#0F172A]">
              Errand &amp; Trip Bundler
            </h3>
            <p className="text-[11.5px] font-medium text-[#64748B]">
              Combine nearby stops into one clean-window loop
            </p>
          </div>
        </div>

        <span className="inline-flex items-center self-start rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#334155] tabular-nums-strict sm:self-auto">
          {bundledCount} {bundledCount === 1 ? 'stop' : 'stops'} selected
        </span>
      </div>

      {/* Toggleable Quick Errand Chips + Custom Stop Input */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {allErrandChips.map((chip) => {
          const active = selectedErrands.includes(chip);
          const isCustom = customErrands.includes(chip);
          return (
            <div key={chip} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => onToggleErrand(chip)}
                aria-pressed={active}
                className={`apple-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  active
                    ? 'border-[#34C759]/45 bg-[#34C759]/14 text-[#15803D]'
                    : 'border-slate-200/90 bg-white text-[#475569] hover:border-slate-300 hover:text-[#0F172A]'
                } ${isCustom ? 'pr-2' : ''}`}
              >
                {active && <Check className="h-3 w-3 stroke-[3]" aria-hidden="true" />}
                <span>{chip}</span>
                {isCustom && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove custom stop ${chip}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCustomErrand(chip);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveCustomErrand(chip);
                      }
                    }}
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-[#0F172A]"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden="true" />
                  </span>
                )}
              </button>
            </div>
          );
        })}

        <form onSubmit={handleAddStopSubmit} className="inline-flex items-center gap-1">
          <input
            type="text"
            value={customStopInput}
            onChange={(e) => setCustomStopInput(e.target.value)}
            placeholder="+ Custom stop"
            aria-label="Add custom errand stop"
            maxLength={28}
            className="h-8 w-32 rounded-full border border-slate-200/90 bg-slate-50/90 px-3 text-[12px] font-semibold text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#34C759] focus:bg-white focus:outline-none"
          />
          {customStopInput.trim().length > 0 && (
            <button
              type="submit"
              aria-label="Add stop to bundle"
              className="apple-press inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#0F172A] text-white"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </form>
      </div>

      {/* Dynamic Loop Calculation & Why/Impact Pill */}
      <AnimatePresence mode="wait">
        {bundledCount >= 2 ? (
          <motion.div
            key={`bundle-${bundledCount}-${safeWindowLabel}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="mt-3.5 flex flex-col justify-between gap-2.5 rounded-2xl border border-[#34C759]/25 bg-gradient-to-r from-[#34C759]/[0.08] via-white/95 to-[#00C7BE]/[0.07] px-3.5 py-3 md:flex-row md:items-center"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-extrabold text-[#0F172A] tabular-nums-strict">
                <Clock className="h-3.5 w-3.5 shrink-0 text-[#1E8E3E]" aria-hidden="true" />
                <span>Suggested Single Loop:</span>
                <span className="rounded-full bg-[#34C759]/15 px-2.5 py-0.5 text-[11.5px] font-extrabold text-[#15803D]">
                  {safeWindowLabel}
                </span>
              </div>
              <p className="truncate text-[11.5px] font-semibold text-[#475569]">
                Home → {selectedErrands.join(' → ')} → Home
              </p>
            </div>

            <span className="inline-flex shrink-0 items-center self-start rounded-full bg-white/95 px-3 py-1.5 text-[11.5px] font-extrabold text-[#15803D] shadow-2xs ring-1 ring-[#34C759]/30 tabular-nums-strict md:self-auto">
              Avoids {coldStartsAvoided} cold-start{' '}
              {coldStartsAvoided === 1 ? 'trip' : 'trips'} • ↓ {bundledCo2SavedKg} kg CO₂ • ↓{' '}
              {bundledPm25DropPct}% roadside PM2.5
            </span>
          </motion.div>
        ) : (
          <motion.p
            key="bundle-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-[12px] font-medium text-[#64748B]"
          >
            Select 2+ stops to build a single clean-window loop and cut cold-start exhaust.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BudgetTier, IndoorHack } from '../../types/aeropulse';
import { CircularToggle } from '../CircularToggle';

const HACK_FILTERS: { id: BudgetTier; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free ₹0' },
  { id: 'diy', label: 'DIY < ₹1.5k' },
  { id: 'smart', label: 'Smart' },
];

export interface IndoorHacksCardProps {
  hacks: IndoorHack[];
  onToggleHack: (id: string) => void;
}

export function IndoorHacksCard({ hacks, onToggleHack }: IndoorHacksCardProps) {
  const [hackFilter, setHackFilter] = useState<BudgetTier>('all');

  const filteredHacks = useMemo(
    () => hacks.filter((h) => (hackFilter === 'all' ? true : h.budget === hackFilter)),
    [hacks, hackFilter]
  );

  return (
    <section className="glass-card glass-card-lift rounded-3xl p-6 lg:col-span-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-[#0F172A]">
            Indoor Air Quality Hacks
          </h2>
          <p className="text-[13px] text-[#64748B]">Budget-tiered Indian home fixes</p>
        </div>

        {/* Apple Segmented Budget Filter */}
        <div
          role="tablist"
          aria-label="Filter indoor air quality hacks by budget"
          className="inline-flex items-center self-start rounded-full bg-slate-200/60 p-1 sm:self-auto"
        >
          {HACK_FILTERS.map((f) => {
            const isActive = hackFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setHackFilter(f.id)}
                className={`apple-press relative rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap ${
                  isActive ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="hackFilterPill"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute inset-0 rounded-full bg-white shadow-xs"
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        {filteredHacks.map((hack) => (
          <div
            key={hack.id}
            onClick={() => onToggleHack(hack.id)}
            className={`apple-press flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 transition-colors ${
              hack.completed
                ? 'border-slate-200/70 bg-slate-50/75'
                : hack.source === 'room-audit'
                  ? 'border-[#34C759]/35 bg-[#34C759]/[0.04] hover:border-[#34C759]/55'
                  : 'border-slate-200/80 bg-white/90 hover:border-slate-300'
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <CircularToggle
                checked={hack.completed}
                onChange={() => onToggleHack(hack.id)}
                ariaLabel={`Toggle ${hack.title}`}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={`text-[14px] font-semibold leading-snug ${
                      hack.completed ? 'text-[#64748B] line-through' : 'text-[#0F172A]'
                    }`}
                  >
                    {hack.title}
                  </p>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#0F172A] tabular-nums-strict">
                    {hack.priceLabel}
                  </span>
                  {hack.source === 'room-audit' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#34C759]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-[#15803D]">
                      From Room Audit
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-[#00C7BE]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#0F766E] tabular-nums-strict">
                    {hack.impactPill}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
                    Why: {hack.whyText}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

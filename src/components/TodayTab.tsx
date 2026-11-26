import { useState } from 'react';
import {
  Baby,
  Briefcase,
  Flame,
  GraduationCap,
  HeartPulse,
  Map,
  UserRound,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CityAirProfile,
  IndoorHack,
  PersonaId,
  QuickModifier,
  TodayAdvisoryPayload,
} from '../types/aeropulse';
import { AqiHeatmapCard } from './AqiHeatmapCard';
import { DailyRoutineCard } from './today/DailyRoutineCard';
import { HeroAqiCard } from './today/HeroAqiCard';
import { IndoorHacksCard } from './today/IndoorHacksCard';
import { SmogClockTimeline } from './today/SmogClockTimeline';

interface TodayTabProps {
  city: CityAirProfile;
  isLoadingLiveAqi: boolean;
  liveAqiError: string | null;
  onRetryLiveAqi: () => void;
  persona: PersonaId;
  onSelectPersona: (p: PersonaId) => void;
  modifiers: QuickModifier[];
  onToggleModifier: (m: QuickModifier) => void;
  advisory: TodayAdvisoryPayload | null;
  isLoadingAdvisory: boolean;
  advisoryError: string | null;
  onRetryAdvisory: () => void;
  onToggleRoutine: (id: string) => void;
  hacks: IndoorHack[];
  onToggleHack: (id: string) => void;
}

const PERSONAS: { id: PersonaId; label: string; icon: typeof Baby }[] = [
  { id: 'parent', label: 'Parent with Kids', icon: Baby },
  { id: 'senior', label: 'Senior Citizen', icon: UserRound },
  { id: 'commuter', label: 'Office Commuter', icon: Briefcase },
  { id: 'student', label: 'Student', icon: GraduationCap },
];

export function TodayTab({
  city,
  isLoadingLiveAqi,
  liveAqiError,
  onRetryLiveAqi,
  persona,
  onSelectPersona,
  modifiers,
  onToggleModifier,
  advisory,
  isLoadingAdvisory,
  advisoryError,
  onRetryAdvisory,
  onToggleRoutine,
  hacks,
  onToggleHack,
}: TodayTabProps) {
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const hasAsthma = modifiers.includes('asthma');
  const hasGasStove = modifiers.includes('gasStove');

  return (
    <div className="space-y-6 pb-32">
      {/* Row 1: Persona Strip + Right-Aligned Quick Risk Chips */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {PERSONAS.map((p) => {
            const Icon = p.icon;
            const active = persona === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPersona(p.id)}
                className={`apple-press inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap ${
                  active
                    ? 'bg-[#0F172A] text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,0.35)]'
                    : 'glass-card text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            aria-pressed={showHeatmap}
            className={`apple-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap ${
              showHeatmap
                ? 'bg-[#00C7BE] text-white shadow-[0_6px_16px_-4px_rgba(0,199,190,0.45)]'
                : 'border border-slate-200/90 bg-white/80 text-[#0F172A] hover:bg-white'
            }`}
          >
            <Map className="h-3.5 w-3.5" aria-hidden="true" />
            AQI Heatmap
          </button>

          <button
            type="button"
            onClick={() => onToggleModifier('asthma')}
            aria-pressed={hasAsthma}
            className={`apple-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap ${
              hasAsthma
                ? 'bg-[#FF3B30] text-white shadow-[0_6px_16px_-4px_rgba(255,59,48,0.4)]'
                : 'border border-slate-200/90 bg-white/80 text-[#475569] hover:bg-white hover:text-[#0F172A]'
            }`}
          >
            <HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />
            {hasAsthma ? '✓ Asthma Shield' : '+ Asthma'}
          </button>

          <button
            type="button"
            onClick={() => onToggleModifier('gasStove')}
            aria-pressed={hasGasStove}
            className={`apple-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap ${
              hasGasStove
                ? 'bg-[#FF9500] text-white shadow-[0_6px_16px_-4px_rgba(255,149,0,0.4)]'
                : 'border border-slate-200/90 bg-white/80 text-[#475569] hover:bg-white hover:text-[#0F172A]'
            }`}
          >
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            {hasGasStove ? '✓ Gas Stove' : '+ Gas Stove'}
          </button>
        </div>
      </div>

      {/* Row 2: Full-Width Hero Telemetry & 24-Hour Clean Window Timeline */}
      <HeroAqiCard
        city={city}
        persona={persona}
        modifiers={modifiers}
        isLoadingLiveAqi={isLoadingLiveAqi}
        liveAqiError={liveAqiError}
        onRetryLiveAqi={onRetryLiveAqi}
        advisory={advisory}
        isLoadingAdvisory={isLoadingAdvisory}
        advisoryError={advisoryError}
        onRetryAdvisory={onRetryAdvisory}
        smogClockSlot={<SmogClockTimeline city={city} />}
      />

      {/* Expandable AQI Heatmap Card (Toggled via AQI Heatmap pill) */}
      <AnimatePresence initial={false}>
        {showHeatmap && city.isLive && (
          <motion.div
            key="aqi-heatmap-panel"
            initial={{ opacity: 0, y: -10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <AqiHeatmapCard city={city} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Row 3: 2-Column Bento Action Grid (12 Columns: 6 Left / 6 Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <DailyRoutineCard
          city={city}
          advisory={advisory}
          isLoadingAdvisory={isLoadingAdvisory}
          advisoryError={advisoryError}
          onRetryAdvisory={onRetryAdvisory}
          onToggleRoutine={onToggleRoutine}
        />
        <IndoorHacksCard hacks={hacks} onToggleHack={onToggleHack} />
      </div>
    </div>
  );
}

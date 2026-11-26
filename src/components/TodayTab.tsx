import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Baby,
  Briefcase,
  Flame,
  GraduationCap,
  HeartPulse,
  Loader2,
  Map,
  RefreshCw,
  Sparkles,
  Square,
  UserRound,
  Volume2,
  Wind,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BudgetTier,
  CityAirProfile,
  IndoorHack,
  PersonaId,
  QuickModifier,
  TodayAdvisoryPayload,
} from '../types/aeropulse';
import { AnimatedNumber } from './AnimatedNumber';
import { AqiHeatmapCard } from './AqiHeatmapCard';
import { CircularToggle } from './CircularToggle';

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

const HACK_FILTERS: { id: BudgetTier; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free ₹0' },
  { id: 'diy', label: 'DIY < ₹1.5k' },
  { id: 'smart', label: 'Smart' },
];

type RoutinePeriod = 'Morning' | 'Afternoon' | 'Evening';

function getActiveRoutinePeriod(hour24: number): RoutinePeriod {
  if (hour24 < 12) return 'Morning';
  if (hour24 < 17) return 'Afternoon';
  return 'Evening';
}

function getHumanAirTranslation(pm25: number): { text: string; isClean: boolean } {
  if (Number.isFinite(pm25) && pm25 > 22) {
    const cigs = (pm25 / 22).toFixed(1);
    return { text: `≈ ${cigs} cigarettes/day`, isClean: false };
  }
  return { text: 'Crisp, breathable air', isClean: true };
}

function getSeverityStyles(severity: CityAirProfile['severity'], isLive: boolean) {
  if (!isLive) {
    return {
      pill: 'bg-slate-200/80 text-[#475569] ring-1 ring-slate-300/60',
      numberAccent: 'text-[#475569]',
      glow: 'from-slate-200/30 via-white/40 to-transparent',
    };
  }
  if (severity === 'severe' || severity === 'poor') {
    return {
      pill: 'bg-[#FF3B30]/12 text-[#C81E1E] ring-1 ring-[#FF3B30]/25',
      numberAccent: 'text-[#C81E1E]',
      glow: 'from-[#D49886]/16 via-white/40 to-transparent',
    };
  }
  if (severity === 'moderate') {
    return {
      pill: 'bg-[#FF9500]/14 text-[#B45309] ring-1 ring-[#FF9500]/30',
      numberAccent: 'text-[#B45309]',
      glow: 'from-[#F7DCA5]/20 via-white/40 to-transparent',
    };
  }
  return {
    pill: 'bg-[#34C759]/14 text-[#15803D] ring-1 ring-[#34C759]/30',
    numberAccent: 'text-[#15803D]',
    glow: 'from-[#93C5FD]/18 via-white/40 to-transparent',
  };
}

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
  const [hackFilter, setHackFilter] = useState<BudgetTier>('all');
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [hoveredSlotIdx, setHoveredSlotIdx] = useState<number | null>(null);
  const [isSpeakingVerdict, setIsSpeakingVerdict] = useState<boolean>(false);
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

  const supportsSpeechSynthesis =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  // Reset hovered timeline slot & cancel any active speech when city or persona changes
  useEffect(() => {
    setHoveredSlotIdx(null);
    if (supportsSpeechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeakingVerdict(false);
  }, [city.id, persona, supportsSpeechSynthesis]);

  // Ensure speech stops cleanly on unmount
  useEffect(() => {
    return () => {
      if (supportsSpeechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [supportsSpeechSynthesis]);

  const sev = getSeverityStyles(city.severity, city.isLive);
  const humanAirTranslation = useMemo(() => getHumanAirTranslation(city.pm25), [city.pm25]);
  const hasAsthma = modifiers.includes('asthma');
  const hasGasStove = modifiers.includes('gasStove');

  const visibleRoutines = useMemo(() => advisory?.routines ?? [], [advisory]);
  const completedRoutines = useMemo(
    () => visibleRoutines.filter((r) => r.completed).length,
    [visibleRoutines]
  );

  const filteredHacks = useMemo(
    () => hacks.filter((h) => (hackFilter === 'all' ? true : h.budget === hackFilter)),
    [hacks, hackFilter]
  );

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

  const handleToggleSpeakVerdict = () => {
    if (!supportsSpeechSynthesis || !city.isLive) return;
    if (isSpeakingVerdict) {
      window.speechSynthesis.cancel();
      setIsSpeakingVerdict(false);
      return;
    }

    const verdictLine =
      advisory?.heroVerdict ?? `Safe outdoor window is ${city.safeWindowLabel} in ${city.name}.`;
    const topPrecaution =
      (hasAsthma && advisory?.asthmaTip) ||
      (hasGasStove && advisory?.gasStoveTip) ||
      visibleRoutines[0]?.title ||
      `Best outdoor window is ${city.safeWindowLabel}.`;

    const spokenText = `${city.name} air quality is ${city.aqi} US AQI, ${city.severityLabel.toLowerCase()}. ${verdictLine}. Top precaution: ${topPrecaution}.`;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = 'en-IN';
      utterance.rate = 0.96;
      utterance.onend = () => setIsSpeakingVerdict(false);
      utterance.onerror = () => setIsSpeakingVerdict(false);
      setIsSpeakingVerdict(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsSpeakingVerdict(false);
    }
  };

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
                className={`apple-press inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap shrink-0 ${
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
            className={`apple-press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap shrink-0 ${
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
            className={`apple-press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap shrink-0 ${
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
            className={`apple-press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap shrink-0 ${
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
      <section className="glass-card relative overflow-hidden rounded-3xl p-6 sm:p-7">
        {/* Soft atmospheric corner tint matching live Open-Meteo city severity */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${sev.glow}`}
          aria-hidden="true"
        />

        <div className="relative z-10 space-y-7">
          {liveAqiError && !city.isLive && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF3B30]/25 bg-[#FF3B30]/[0.06] px-4 py-3 text-[13px]">
              <div className="flex items-center gap-2 font-medium text-[#B91C1C]">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{liveAqiError}</span>
              </div>
              <button
                type="button"
                onClick={onRetryLiveAqi}
                className="apple-press inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Retry Open-Meteo
              </button>
            </div>
          )}

          {/* Top Row: Left Live Open-Meteo Telemetry | Right Gemini 1-Line Verdict */}
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3.5" aria-live="polite">
                {city.isLive ? (
                  <div className="flex items-baseline gap-2">
                    <AnimatedNumber
                      value={city.aqi}
                      className="font-display text-[54px] font-extrabold leading-none tracking-[-0.04em] text-[#0F172A] sm:text-[64px]"
                    />
                    <span className="font-display text-[20px] font-bold tracking-[-0.02em] text-[#475569]">
                      US AQI
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-28 animate-pulse rounded-2xl bg-slate-200/80" />
                    <span className="text-[13px] font-semibold text-[#475569]">
                      Fetching live {city.name} AQI...
                    </span>
                  </div>
                )}

                <span
                  className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-[12px] font-extrabold tracking-[0.06em] ${sev.pill}`}
                >
                  {isLoadingLiveAqi && !city.isLive ? 'LIVE SYNC' : city.severityLabel}
                </span>

                {city.isLive && (
                  <span
                    title={
                      humanAirTranslation.isClean
                        ? 'Live PM2.5 is within crisp, clean breathing levels'
                        : 'Berkeley Earth rule of thumb: 22 μg/m³ PM2.5 ≈ 1 cigarette/day'
                    }
                    className={`inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-semibold tabular-nums-strict ring-1 ${
                      humanAirTranslation.isClean
                        ? 'bg-sky-50/90 text-[#0369A1] ring-sky-200/75'
                        : 'bg-stone-100/90 text-[#57534E] ring-stone-200/85'
                    }`}
                  >
                    {humanAirTranslation.text}
                  </span>
                )}

                {city.isLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#00C7BE]/12 px-3 py-1.5 text-[12px] font-semibold text-[#0F766E] ring-1 ring-[#00C7BE]/25">
                    <Wind className="h-3.5 w-3.5" aria-hidden="true" />
                    Est. Indoor CO₂:{' '}
                    <AnimatedNumber value={city.indoorCo2} suffix=" ppm" className="font-bold" />
                  </span>
                )}
              </div>

              {/* Inline Live Open-Meteo Pollutant Telemetry Chips */}
              <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-[#475569]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 px-3 py-1 tabular-nums-strict">
                  <span className="text-[#64748B]">PM2.5:</span>
                  {city.isLive ? (
                    <AnimatedNumber
                      value={city.pm25}
                      decimals={1}
                      suffix=" μg/m³"
                      className="font-bold text-[#0F172A]"
                    />
                  ) : (
                    <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-slate-200" />
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 px-3 py-1 tabular-nums-strict">
                  <span className="text-[#64748B]">PM10:</span>
                  {city.isLive ? (
                    <AnimatedNumber
                      value={city.pm10}
                      decimals={1}
                      suffix=" μg/m³"
                      className="font-bold text-[#0F172A]"
                    />
                  ) : (
                    <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-slate-200" />
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 px-3 py-1 tabular-nums-strict">
                  <span className="text-[#64748B]">NO₂:</span>
                  {city.isLive ? (
                    <AnimatedNumber
                      value={city.no2}
                      decimals={1}
                      suffix=" μg/m³"
                      className="font-bold text-[#0F172A]"
                    />
                  ) : (
                    <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-slate-200" />
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/90 px-3 py-1 tabular-nums-strict">
                  <span className="text-[#64748B]">O₃:</span>
                  {city.isLive ? (
                    <AnimatedNumber
                      value={city.o3}
                      decimals={1}
                      suffix=" μg/m³"
                      className="font-bold text-[#0F172A]"
                    />
                  ) : (
                    <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-slate-200" />
                  )}
                </span>
              </div>
            </div>

            {/* Right: Bold 1-Line Context-Aware Gemini Verdict */}
            <div className="lg:max-w-md lg:text-right">
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#64748B]">
                  {isLoadingAdvisory ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00C7BE]" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-[#34C759]" aria-hidden="true" />
                  )}
                  {isLoadingAdvisory ? 'Personalizing with Gemini...' : 'AeroPulse Verdict'}
                </div>

                {supportsSpeechSynthesis && city.isLive && !isLoadingAdvisory && (
                  <button
                    type="button"
                    onClick={handleToggleSpeakVerdict}
                    aria-pressed={isSpeakingVerdict}
                    aria-label={
                      isSpeakingVerdict
                        ? 'Stop reading today air quality verdict'
                        : 'Listen to today air quality verdict and top precaution'
                    }
                    className={`apple-press inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-bold transition-colors backdrop-blur-md ${
                      isSpeakingVerdict
                        ? 'bg-[#FF3B30]/12 text-[#C81E1E] ring-1 ring-[#FF3B30]/30'
                        : 'bg-white/85 text-[#0F172A] ring-1 ring-slate-200/90 hover:bg-white'
                    }`}
                  >
                    {isSpeakingVerdict ? (
                      <>
                        <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3.5 w-3.5 text-[#0F766E]" aria-hidden="true" />
                        <span>Listen</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {isLoadingAdvisory && !advisory ? (
                <div className="mt-2 space-y-2 lg:ml-auto lg:w-72">
                  <div className="h-7 w-full animate-pulse rounded-xl bg-slate-200/80" />
                  <div className="h-4 w-2/3 animate-pulse rounded-lg bg-slate-200/60 lg:ml-auto" />
                </div>
              ) : advisoryError && !advisory ? (
                <div className="mt-2 flex flex-col items-start gap-2 lg:items-end">
                  <p className="text-[13px] font-semibold text-[#B91C1C]">{advisoryError}</p>
                  <button
                    type="button"
                    onClick={onRetryAdvisory}
                    className="apple-press inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-3 py-1 text-[11.5px] font-semibold text-white"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Retry Verdict
                  </button>
                </div>
              ) : (
                <motion.h1
                  key={`${city.id}-${persona}-${advisory?.heroVerdict ?? 'pending'}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-1 font-display text-[24px] font-extrabold leading-tight tracking-[-0.025em] text-[#0F172A] sm:text-[28px]"
                  style={{ textWrap: 'balance' }}
                >
                  {advisory?.heroVerdict ??
                    (city.isLive
                      ? `Safe window ${city.safeWindowLabel} in ${city.name}`
                      : `Loading live ${city.name} guidance...`)}
                </motion.h1>
              )}

              {(hasAsthma || hasGasStove) && advisory && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 lg:justify-end">
                  {hasAsthma && advisory.asthmaTip && (
                    <span className="inline-flex items-center rounded-full bg-[#FF3B30]/10 px-3 py-1 text-[12px] font-semibold text-[#C81E1E]">
                      {advisory.asthmaTip}
                    </span>
                  )}
                  {hasGasStove && advisory.gasStoveTip && (
                    <span className="inline-flex items-center rounded-full bg-[#FF9500]/12 px-3 py-1 text-[12px] font-semibold text-[#B45309]">
                      {advisory.gasStoveTip}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Real 24-Hour Visual Smog Clock (6 AM to 11 PM from Open-Meteo) */}
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
        </div>
      </section>

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
        {/* Left 6 Cols: Gemini Context-Aware Low-Emission Daily Routine */}
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
                                  item.completed
                                    ? 'text-[#64748B] line-through'
                                    : 'text-[#0F172A]'
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

        {/* Right 6 Cols: Indoor Air Quality Hacks */}
        <section className="glass-card glass-card-lift rounded-3xl p-6 lg:col-span-6">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-[#0F172A]">
                Indoor Air Quality Hacks
              </h2>
              <p className="text-[13px] text-[#64748B]">
                Budget-tiered Indian home fixes
              </p>
            </div>

            {/* Apple Segmented Budget Filter */}
            <div
              role="tablist"
              aria-label="Filter indoor air quality hacks by budget"
              className="inline-flex items-center rounded-full bg-slate-200/60 p-1 self-start sm:self-auto"
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
      </div>
    </div>
  );
}

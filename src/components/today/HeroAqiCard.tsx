import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  Volume2,
  Wind,
} from 'lucide-react';
import { motion } from 'motion/react';
import { CityAirProfile, PersonaId, QuickModifier, TodayAdvisoryPayload } from '../../types/aeropulse';
import { AnimatedNumber } from '../AnimatedNumber';

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

export interface HeroAqiCardProps {
  city: CityAirProfile;
  persona: PersonaId;
  modifiers: QuickModifier[];
  isLoadingLiveAqi: boolean;
  liveAqiError: string | null;
  onRetryLiveAqi: () => void;
  advisory: TodayAdvisoryPayload | null;
  isLoadingAdvisory: boolean;
  advisoryError: string | null;
  onRetryAdvisory: () => void;
  smogClockSlot?: ReactNode;
}

export function HeroAqiCard({
  city,
  persona,
  modifiers,
  isLoadingLiveAqi,
  liveAqiError,
  onRetryLiveAqi,
  advisory,
  isLoadingAdvisory,
  advisoryError,
  onRetryAdvisory,
  smogClockSlot,
}: HeroAqiCardProps) {
  const [isSpeakingVerdict, setIsSpeakingVerdict] = useState<boolean>(false);

  const supportsSpeechSynthesis =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  // Cancel any active speech when city or persona changes
  useEffect(() => {
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

        {smogClockSlot}
      </div>
    </section>
  );
}

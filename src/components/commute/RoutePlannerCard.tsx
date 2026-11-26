import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Bike,
  Car,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrainFront,
  Users,
  Wind,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  CityAirProfile,
  CommuteAnalysisResult,
  CommuteGearBadge,
  CommuteMode,
  CommuteTimeSlot,
  LatLngPoint,
} from '../../types/aeropulse';
import { sanitizeUserInput } from '../../utils/impactCalc';
import { AnimatedNumber } from '../AnimatedNumber';
import { CommuteRouteMap } from '../CommuteRouteMap';

interface PhotonSuggestion {
  id: string;
  name: string;
  subtitle: string;
  label: string;
  lat: number;
  lng: number;
}

const TIME_SLOTS: { id: CommuteTimeSlot; label: string; factor: number }[] = [
  { id: '8:30-peak', label: '8:30 AM Peak', factor: 1.05 },
  { id: '10:30-mid', label: '10:30 AM', factor: 0.82 },
  { id: '2:00-safe', label: '2:00 PM Safe', factor: 0.52 },
];

const MODES: { id: CommuteMode; label: string; icon: typeof TrainFront }[] = [
  { id: 'metro', label: 'Metro', icon: TrainFront },
  { id: 'carpool', label: 'Carpool', icon: Users },
  { id: 'car', label: 'Car', icon: Car },
  { id: 'two-wheeler', label: '2-Wheeler', icon: Bike },
];

function getGearBadgeClasses(tone: CommuteGearBadge['tone']): string {
  switch (tone) {
    case 'coral':
      return 'bg-[#FF3B30]/10 text-[#C81E1E] ring-[#FF3B30]/25';
    case 'amber':
      return 'bg-[#FF9500]/12 text-[#B45309] ring-[#FF9500]/25';
    case 'emerald':
      return 'bg-[#34C759]/12 text-[#15803D] ring-[#34C759]/25';
    case 'cyan':
      return 'bg-[#00C7BE]/12 text-[#0F766E] ring-[#00C7BE]/25';
    default:
      return 'bg-white text-[#334155] ring-slate-200/80';
  }
}

function formatLongDuration(mins: number): string {
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export interface AnalyzeRouteParams {
  originText: string;
  destinationText: string;
  slot: CommuteTimeSlot;
  mode: CommuteMode;
  activeCity: CityAirProfile;
  resolvedOriginCoords?: LatLngPoint | null;
  resolvedDestCoords?: LatLngPoint | null;
}

export async function fetchCommuteAnalysis(
  params: AnalyzeRouteParams
): Promise<{ data?: CommuteAnalysisResult; error?: string }> {
  const trimmedOrigin = sanitizeUserInput(params.originText, 120);
  const trimmedDestination = sanitizeUserInput(params.destinationText, 120);
  if (!trimmedOrigin || !trimmedDestination) return {};

  try {
    const res = await fetch('/api/commute/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: trimmedOrigin,
        destination: trimmedDestination,
        cityName: params.activeCity.name,
        aqi: params.activeCity.aqi,
        departureSlot: params.slot,
        selectedMode: params.mode,
        cityCenter: params.activeCity.center,
        originCoords: params.resolvedOriginCoords ?? undefined,
        destinationCoords: params.resolvedDestCoords ?? undefined,
      }),
    });

    const rawText = await res.text();
    if (!rawText || rawText.trimStart().startsWith('<')) {
      return { error: 'Route service is restarting or temporarily unavailable. Please tap Retry.' };
    }

    let parsed: (CommuteAnalysisResult & { error?: string; message?: string }) | null = null;
    try {
      parsed = JSON.parse(rawText) as CommuteAnalysisResult & { error?: string; message?: string };
    } catch {
      return { error: 'Received an unexpected response from the routing service. Please retry.' };
    }

    if (!res.ok) {
      return { error: parsed.message || 'Unable to plot route between those locations.' };
    }
    return { data: parsed };
  } catch {
    return { error: 'Network error while computing live OpenStreetMap / OSRM route.' };
  }
}

export interface RoutePlannerCardProps {
  city: CityAirProfile;
  origin: string;
  destination: string;
  departureSlot: CommuteTimeSlot;
  selectedMode: CommuteMode;
  analysis: CommuteAnalysisResult | null;
  isLoadingRoute: boolean;
  routeError: string | null;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSelectOriginSuggestion: (label: string, coords: LatLngPoint) => void;
  onSelectDestinationSuggestion: (label: string, coords: LatLngPoint) => void;
  onSubmitRoute: () => void;
  onSwapRoute: () => void;
  onRetryRoute: () => void;
  onSelectSlot: (slot: CommuteTimeSlot) => void;
  onSelectMode: (mode: CommuteMode) => void;
  errandSlot?: ReactNode;
}

export function RoutePlannerCard({
  city,
  origin,
  destination,
  departureSlot,
  selectedMode,
  analysis,
  isLoadingRoute,
  routeError,
  onOriginChange,
  onDestinationChange,
  onSelectOriginSuggestion,
  onSelectDestinationSuggestion,
  onSubmitRoute,
  onSwapRoute,
  onRetryRoute,
  onSelectSlot,
  onSelectMode,
  errandSlot,
}: RoutePlannerCardProps) {
  const [activeAutocomplete, setActiveAutocomplete] = useState<'origin' | 'destination' | null>(null);
  const [suggestions, setSuggestions] = useState<PhotonSuggestion[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const routeFormRef = useRef<HTMLFormElement | null>(null);

  // Close frosted autocomplete dropdown on outside click or Escape
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (routeFormRef.current && !routeFormRef.current.contains(e.target as Node)) {
        setActiveAutocomplete(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveAutocomplete(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Reset open autocomplete when switching cities
  useEffect(() => {
    setActiveAutocomplete(null);
  }, [city.id]);

  // Debounced Photon fuzzy Indian place autocomplete biased to active city coordinates
  const activeQuery =
    activeAutocomplete === 'origin'
      ? origin
      : activeAutocomplete === 'destination'
        ? destination
        : '';

  useEffect(() => {
    if (!activeAutocomplete) {
      setSuggestions([]);
      setIsSearchingPlaces(false);
      return;
    }

    const trimmed = sanitizeUserInput(activeQuery, 100);
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsSearchingPlaces(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearchingPlaces(true);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          city: city.name,
          lat: String(city.center.lat),
          lon: String(city.center.lng),
        });
        const res = await fetch(`/api/commute/autocomplete?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const rawText = await res.text();
        if (!rawText || rawText.trimStart().startsWith('<')) {
          setSuggestions([]);
          return;
        }
        const data = JSON.parse(rawText) as { suggestions?: PhotonSuggestion[] };
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingPlaces(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeAutocomplete, activeQuery, city.name, city.center.lat, city.center.lng]);

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    setActiveAutocomplete(null);
    onSubmitRoute();
  };

  const handleSwap = () => {
    setActiveAutocomplete(null);
    onSwapRoute();
  };

  const handlePickSuggestion = (field: 'origin' | 'destination', item: PhotonSuggestion) => {
    const coords = { lat: item.lat, lng: item.lng };
    setActiveAutocomplete(null);
    setSuggestions([]);
    if (field === 'origin') {
      onSelectOriginSuggestion(item.label, coords);
    } else {
      onSelectDestinationSuggestion(item.label, coords);
    }
  };

  // Fallback baseline values only while initial live route request is in flight
  const slotObj = TIME_SLOTS.find((t) => t.id === departureSlot) ?? TIME_SLOTS[0];
  const fallbackExposureAqi = Math.round(city.aqi * slotObj.factor);
  const fallbackRecExposureAqi = Math.max(36, Math.round(fallbackExposureAqi * 0.34));

  const recTitle =
    analysis?.recommended.title ??
    (selectedMode === 'carpool' ? 'AC Carpool + Recirculate' : 'Metro / Public Transit');
  const recDurationMins = analysis?.recommended.durationMins ?? 0;
  const recDistanceKm = analysis?.recommended.distanceKm ?? 0;
  const recExposureAqi = analysis?.recommended.exposureAqi ?? fallbackRecExposureAqi;
  const recExposureLabel = analysis?.recommended.exposureLabel ?? 'Low Exposure';
  const co2SavedTrip = analysis?.recommended.co2SavedKg ?? 1.8;
  const recWhyLine =
    analysis?.recommended.whyLine ??
    'Calculating real transit corridor & particulate dose via OpenStreetMap & OSRM.';

  const riskTitle =
    analysis?.highRisk.title ??
    (selectedMode === 'two-wheeler' ? 'Open 2-Wheeler in Traffic' : 'Solo Car in Traffic');
  const riskDurationMins = analysis?.highRisk.durationMins ?? 0;
  const riskDistanceKm = analysis?.highRisk.distanceKm ?? 0;
  const riskExposureAqi = analysis?.highRisk.exposureAqi ?? fallbackExposureAqi;
  const riskExposureLabel = analysis?.highRisk.exposureLabel ?? 'High Exposure';
  const riskCo2Trip = analysis?.highRisk.co2AddedKg ?? 2.1;
  const riskWhyLine =
    analysis?.highRisk.whyLine ??
    'Stop-and-go traffic traps tailpipe NO₂ and PM2.5 in the breathing zone.';

  const rawGearBadges: CommuteGearBadge[] = analysis?.gearBadges ?? [
    {
      label: city.aqi >= 150 ? 'N95 Mask Advised' : 'Breathable Air',
      tone: city.aqi >= 200 ? 'coral' : city.aqi >= 150 ? 'amber' : 'emerald',
    },
    { label: 'Car AC: Recirculate', tone: 'cyan' },
  ];
  // Remove static "Bundle Errands" badge since the interactive Errand & Trip Bundler card sits right below
  const gearBadges = rawGearBadges.filter((b) => !/bundle.*errand/i.test(b.label));

  return (
    <section className="glass-card rounded-3xl p-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/70 pb-5 xl:flex-row xl:items-center">
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-[-0.025em] text-[#0F172A]">
            Smart Commute Advisor
          </h1>
          <p className="text-[13px] text-[#64748B]">
            Live Indian routes · real CO₂ savings & inhaled PM2.5 dose
          </p>
        </div>

        {/* Origin ⇄ Destination Form with Photon Frosted-Glass Autocomplete */}
        <form
          ref={routeFormRef}
          onSubmit={handleFormSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          {/* Origin Input + Autocomplete */}
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#34C759]"
              aria-hidden="true"
            />
            <input
              type="text"
              autoComplete="off"
              aria-label="Origin location in India"
              placeholder="Origin (e.g., Jatani Railway Station)"
              value={origin}
              onFocus={() => setActiveAutocomplete('origin')}
              onChange={(e) => {
                onOriginChange(e.target.value);
                setActiveAutocomplete('origin');
              }}
              className="h-10 w-52 rounded-full border border-slate-200/90 bg-white/95 pl-8 pr-3.5 text-[13px] font-semibold text-[#0F172A] focus:border-[#34C759] focus:outline-none sm:w-56"
            />

            {activeAutocomplete === 'origin' && origin.trim().length >= 2 && (
              <div
                role="listbox"
                aria-label="Origin place suggestions"
                className="glass-floating absolute left-0 top-full z-[650] mt-2 w-72 overflow-hidden rounded-2xl p-1.5"
              >
                {isSearchingPlaces ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[#64748B]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00C7BE]" />
                    Searching Indian places near {city.name}…
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-3 py-2.5 text-[12px] font-medium text-[#64748B]">
                    No matches yet — keep typing or press Plot Route.
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handlePickSuggestion('origin', item);
                      }}
                      className="apple-press flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100/90"
                    >
                      <MapPin
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34C759]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-bold text-[#0F172A]">
                          {item.name}
                        </div>
                        <div className="truncate text-[11px] font-medium text-[#64748B]">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleSwap}
            aria-label="Swap origin and destination"
            className="apple-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white text-[#475569] hover:text-[#0F172A]"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Destination Input + Autocomplete */}
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#FF3B30]"
              aria-hidden="true"
            />
            <input
              type="text"
              autoComplete="off"
              aria-label="Destination location in India"
              placeholder="Destination (e.g., Cyber City)"
              value={destination}
              onFocus={() => setActiveAutocomplete('destination')}
              onChange={(e) => {
                onDestinationChange(e.target.value);
                setActiveAutocomplete('destination');
              }}
              className="h-10 w-52 rounded-full border border-slate-200/90 bg-white/95 pl-8 pr-3.5 text-[13px] font-semibold text-[#0F172A] focus:border-[#34C759] focus:outline-none sm:w-56"
            />

            {activeAutocomplete === 'destination' && destination.trim().length >= 2 && (
              <div
                role="listbox"
                aria-label="Destination place suggestions"
                className="glass-floating absolute left-0 top-full z-[650] mt-2 w-72 overflow-hidden rounded-2xl p-1.5 sm:left-auto sm:right-0"
              >
                {isSearchingPlaces ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[#64748B]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00C7BE]" />
                    Searching Indian places near {city.name}…
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-3 py-2.5 text-[12px] font-medium text-[#64748B]">
                    No matches yet — keep typing or press Plot Route.
                  </div>
                ) : (
                  suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handlePickSuggestion('destination', item);
                      }}
                      className="apple-press flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100/90"
                    >
                      <MapPin
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF3B30]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-bold text-[#0F172A]">
                          {item.name}
                        </div>
                        <div className="truncate text-[11px] font-medium text-[#64748B]">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoadingRoute}
            className="apple-press inline-flex h-10 items-center gap-1.5 rounded-full bg-[#0F172A] px-4 text-[12px] font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-60"
          >
            {isLoadingRoute ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Plot Route</span>
          </button>
        </form>
      </div>

      {/* Interactive Light Minimal Route Map Card */}
      <div className="mt-5">
        <CommuteRouteMap
          city={city}
          analysis={analysis}
          selectedMode={selectedMode}
          isLoadingRoute={isLoadingRoute}
          originLabel={origin}
          destinationLabel={destination}
        />
        {routeError && (
          <div
            role="alert"
            className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#FF3B30]/25 bg-rose-50/85 px-4 py-2.5 text-[12px] backdrop-blur-xl"
          >
            <span className="font-semibold text-[#C81E1E]">{routeError}</span>
            <button
              type="button"
              onClick={onRetryRoute}
              className="apple-press inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-3 py-1 text-[11.5px] font-bold text-white hover:bg-slate-800"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Retry Route
            </button>
          </div>
        )}
      </div>

      {/* Departure Time Segmented Control + Mode Pills */}
      <div className="mt-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div
          role="tablist"
          aria-label="Departure time window"
          className="inline-flex items-center self-start rounded-full bg-slate-200/60 p-1"
        >
          {TIME_SLOTS.map((slot) => {
            const active = departureSlot === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectSlot(slot.id)}
                className={`apple-press relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold whitespace-nowrap ${
                  active ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="commuteTimePill"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute inset-0 rounded-full bg-white shadow-xs"
                  />
                )}
                <Clock className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
                <span className="relative z-10">{slot.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = selectedMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectMode(m.id)}
                className={`apple-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap ${
                  active
                    ? 'bg-[#0F172A] text-white shadow-sm'
                    : 'border border-slate-200/90 bg-white/85 text-[#475569] hover:bg-white hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Maps-Grounded Side-by-Side Comparison Cards */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Recommended Low-Emission Option (Emerald) */}
        <div className="rounded-3xl border border-[#34C759]/30 bg-gradient-to-br from-[#34C759]/10 via-white/90 to-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#34C759] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.05em] text-white">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Recommended
            </span>
            <span className="font-display text-[15px] font-extrabold text-[#1E8E3E] tabular-nums-strict">
              {recDurationMins > 0 ? (
                <>
                  {recDurationMins >= 120 ? (
                    <span>{formatLongDuration(recDurationMins)}</span>
                  ) : (
                    <AnimatedNumber value={recDurationMins} suffix=" min" />
                  )}{' '}
                  · <AnimatedNumber value={recDistanceKm} decimals={1} suffix=" km" />
                </>
              ) : (
                <>~<AnimatedNumber value={recExposureAqi} /> AQI cabin</>
              )}
            </span>
          </div>

          <h2 className="mt-3 font-display text-[20px] font-extrabold tracking-[-0.02em] text-[#0F172A]">
            {recTitle}
          </h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#34C759]/15 px-3 py-1 text-[12px] font-bold text-[#15803D] tabular-nums-strict">
              {recExposureLabel} · ~<AnimatedNumber value={recExposureAqi} /> AQI
            </span>
            <span className="inline-flex items-center rounded-full bg-[#00C7BE]/14 px-3 py-1 text-[12px] font-bold text-[#0F766E] tabular-nums-strict">
              Saves <AnimatedNumber value={co2SavedTrip} decimals={1} /> kg CO₂
            </span>
          </div>

          <p className="mt-3 text-[13px] font-medium text-[#334155]">
            <span className="font-bold text-[#0F172A]">Why &amp; Impact:</span> {recWhyLine}
          </p>
        </div>

        {/* High-Exposure Option (Coral) */}
        <div className="rounded-3xl border border-[#FF3B30]/25 bg-gradient-to-br from-[#FF3B30]/9 via-white/90 to-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center rounded-full bg-[#FF3B30] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.05em] text-white">
              High Risk
            </span>
            <span className="font-display text-[15px] font-extrabold text-[#C81E1E] tabular-nums-strict">
              {riskDurationMins > 0 ? (
                <>
                  {riskDurationMins >= 120 ? (
                    <span>{formatLongDuration(riskDurationMins)}</span>
                  ) : (
                    <AnimatedNumber value={riskDurationMins} suffix=" min" />
                  )}{' '}
                  · <AnimatedNumber value={riskDistanceKm} decimals={1} suffix=" km" />
                </>
              ) : (
                <>
                  <AnimatedNumber value={riskExposureAqi} /> AQI roadside
                </>
              )}
            </span>
          </div>

          <h2 className="mt-3 font-display text-[20px] font-extrabold tracking-[-0.02em] text-[#0F172A]">
            {riskTitle}
          </h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#FF3B30]/12 px-3 py-1 text-[12px] font-bold text-[#C81E1E] tabular-nums-strict">
              {riskExposureLabel} · <AnimatedNumber value={riskExposureAqi} /> AQI
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-[#334155] tabular-nums-strict">
              +<AnimatedNumber value={riskCo2Trip} decimals={1} /> kg CO₂
            </span>
          </div>

          <p className="mt-3 text-[13px] font-medium text-[#334155]">
            <span className="font-bold text-[#0F172A]">Why &amp; Impact:</span> {riskWhyLine}
          </p>
        </div>
      </div>

      {/* Maps-Grounded Gemini Transit Advisory + Google Maps Source Links */}
      {analysis &&
        (analysis.geminiInsight ||
          analysis.geminiQuotaLimited ||
          analysis.groundingLinks.length > 0) && (
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Sparkles
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#00C7BE]"
                  aria-hidden="true"
                />
                <p className="text-[12.5px] font-medium leading-snug text-[#1E293B]">
                  <span className="font-bold text-[#0F172A]">Corridor Transit Note: </span>
                  {analysis.geminiInsight
                    ? analysis.geminiInsight
                    : analysis.geminiQuotaLimited
                      ? 'Live OSRM road distance & transit timing active. AI transit summary paused due to Gemini API quota limits (add a billing-enabled key in Settings > Secrets for higher limits).'
                      : 'Verified OpenStreetMap corridor and transit timing.'}
                </p>
              </div>
            </div>

            {analysis.groundingLinks.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#64748B]">
                  OpenStreetMap:
                </span>
                {analysis.groundingLinks.map((link) => (
                  <a
                    key={link.uri}
                    href={link.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100/90 px-2.5 py-0.5 text-[11px] font-semibold text-[#0F172A] transition-colors hover:bg-slate-200/80"
                  >
                    <span className="max-w-[160px] truncate">{link.title}</span>
                    <ExternalLink
                      className="h-3 w-3 shrink-0 text-[#64748B]"
                      aria-hidden="true"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

      {/* Dynamic Bottom Gear Strip (Updates with Real Duration & Live AQI) */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50/90 px-4 py-3 text-[12px] font-semibold text-[#334155] ring-1 ring-slate-200/70">
        <span className="inline-flex items-center gap-1.5 text-[#0F172A]">
          <Wind className="h-3.5 w-3.5 text-[#00C7BE]" aria-hidden="true" />
          Trip Gear:
        </span>
        {gearBadges.map((badge) => (
          <span
            key={badge.label}
            className={`rounded-full px-3 py-1 ring-1 tabular-nums-strict ${getGearBadgeClasses(
              badge.tone
            )}`}
          >
            {badge.label}
          </span>
        ))}
      </div>

      {errandSlot}
    </section>
  );
}

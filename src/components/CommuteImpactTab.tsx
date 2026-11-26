import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Bike,
  Car,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TrainFront,
  Users,
  Wind,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CityAirProfile,
  CommuteAnalysisResult,
  CommuteGearBadge,
  CommuteLiveSnapshot,
  CommuteMode,
  CommuteTimeSlot,
  ExternalMapRouteRequest,
  HabitSwap,
  LatLngPoint,
} from '../types/aeropulse';
import {
  calculateErrandBundleImpact,
  calculateHabitSimulatorImpact,
  sanitizeUserInput,
} from '../utils/impactCalc';
import { AnimatedNumber } from './AnimatedNumber';
import { CommuteRouteMap } from './CommuteRouteMap';
import { buildWhatsAppBroadcastMessage, WhatsAppLanguage } from './WhatsAppAlertModal';

interface PhotonSuggestion {
  id: string;
  name: string;
  subtitle: string;
  label: string;
  lat: number;
  lng: number;
}

const DEFAULT_ERRAND_CHIPS = ['Groceries', 'Pharmacy', 'School Pickup', 'Gym / Bank'] as const;

interface CommuteImpactTabProps {
  city: CityAirProfile;
  habits: HabitSwap[];
  onToggleHabit: (id: string) => void;
  onChangeHabitDays: (id: string, days: number) => void;
  onShowToast: (message: string) => void;
  onSnapshotChange?: (snapshot: CommuteLiveSnapshot) => void;
  externalRouteRequest?: ExternalMapRouteRequest | null;
  onExternalRouteHandled?: () => void;
  selectedErrands: string[];
  customErrands: string[];
  onToggleErrand: (errand: string) => void;
  onAddCustomErrand: (errand: string) => void;
  onRemoveCustomErrand: (errand: string) => void;
  whatsappLang: WhatsAppLanguage;
  onChangeWhatsappLang: (lang: WhatsAppLanguage) => void;
  onOpenWhatsappModal: () => void;
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

export function CommuteImpactTab({
  city,
  habits,
  onToggleHabit,
  onChangeHabitDays,
  onShowToast,
  onSnapshotChange,
  externalRouteRequest,
  onExternalRouteHandled,
  selectedErrands,
  customErrands,
  onToggleErrand,
  onAddCustomErrand,
  onRemoveCustomErrand,
  whatsappLang,
  onChangeWhatsappLang,
  onOpenWhatsappModal,
}: CommuteImpactTabProps) {
  const [origin, setOrigin] = useState(externalRouteRequest?.origin || city.defaultOrigin);
  const [destination, setDestination] = useState(
    externalRouteRequest?.destination || city.defaultDestination
  );
  const [originCoords, setOriginCoords] = useState<LatLngPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<LatLngPoint | null>(null);
  const [activeAutocomplete, setActiveAutocomplete] = useState<'origin' | 'destination' | null>(null);
  const [suggestions, setSuggestions] = useState<PhotonSuggestion[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);

  const [departureSlot, setDepartureSlot] = useState<CommuteTimeSlot>('8:30-peak');
  const [selectedMode, setSelectedMode] = useState<CommuteMode>('metro');
  const [scale, setScale] = useState<'family' | 'colony'>('family');
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const [customStopInput, setCustomStopInput] = useState('');

  const [analysis, setAnalysis] = useState<CommuteAnalysisResult | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const requestCounterRef = useRef(0);
  const routeFormRef = useRef<HTMLFormElement | null>(null);
  const lastCityIdRef = useRef<string | null>(null);
  const lastExternalReqIdRef = useRef<number | null>(null);

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

  const analyzeRoute = useCallback(
    async (params: {
      originText: string;
      destinationText: string;
      slot: CommuteTimeSlot;
      mode: CommuteMode;
      activeCity: CityAirProfile;
      resolvedOriginCoords?: LatLngPoint | null;
      resolvedDestCoords?: LatLngPoint | null;
    }) => {
      const trimmedOrigin = sanitizeUserInput(params.originText, 120);
      const trimmedDestination = sanitizeUserInput(params.destinationText, 120);
      if (!trimmedOrigin || !trimmedDestination) return;

      const reqId = ++requestCounterRef.current;
      setIsLoadingRoute(true);
      setRouteError(null);

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

        if (reqId !== requestCounterRef.current) return;

        const rawText = await res.text();
        if (!rawText || rawText.trimStart().startsWith('<')) {
          setRouteError('Route service is restarting or temporarily unavailable. Please tap Retry.');
          return;
        }

        let data: (CommuteAnalysisResult & { error?: string; message?: string }) | null = null;
        try {
          data = JSON.parse(rawText) as CommuteAnalysisResult & {
            error?: string;
            message?: string;
          };
        } catch {
          setRouteError('Received an unexpected response from the routing service. Please retry.');
          return;
        }

        if (!res.ok) {
          setRouteError(data.message || 'Unable to plot route between those locations.');
          return;
        }

        setAnalysis(data);
      } catch {
        if (reqId === requestCounterRef.current) {
          setRouteError('Network error while computing live OpenStreetMap / OSRM route.');
        }
      } finally {
        if (reqId === requestCounterRef.current) {
          setIsLoadingRoute(false);
        }
      }
    },
    []
  );

  // Coordinate Chat-to-Map external route requests & city switches cleanly without clobbering
  useEffect(() => {
    if (
      externalRouteRequest &&
      externalRouteRequest.requestId !== lastExternalReqIdRef.current
    ) {
      lastExternalReqIdRef.current = externalRouteRequest.requestId;
      lastCityIdRef.current = city.id;
      setOrigin(externalRouteRequest.origin);
      setDestination(externalRouteRequest.destination);
      setOriginCoords(null);
      setDestinationCoords(null);
      setActiveAutocomplete(null);
      void analyzeRoute({
        originText: externalRouteRequest.origin,
        destinationText: externalRouteRequest.destination,
        slot: departureSlot,
        mode: selectedMode,
        activeCity: city,
        resolvedOriginCoords: null,
        resolvedDestCoords: null,
      });
      onExternalRouteHandled?.();
      return;
    }

    if (lastCityIdRef.current !== city.id) {
      lastCityIdRef.current = city.id;
      setOrigin(city.defaultOrigin);
      setDestination(city.defaultDestination);
      setOriginCoords(null);
      setDestinationCoords(null);
      setActiveAutocomplete(null);
      void analyzeRoute({
        originText: city.defaultOrigin,
        destinationText: city.defaultDestination,
        slot: departureSlot,
        mode: selectedMode,
        activeCity: city,
        resolvedOriginCoords: null,
        resolvedDestCoords: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id, externalRouteRequest?.requestId]);

  // Sync live commute route details into global App state for the Ask AeroPulse Copilot
  useEffect(() => {
    const isLowEmission = selectedMode === 'metro' || selectedMode === 'carpool';
    onSnapshotChange?.({
      origin,
      destination,
      departureSlot,
      selectedMode,
      distanceKm: analysis
        ? isLowEmission
          ? analysis.recommended.distanceKm
          : analysis.highRisk.distanceKm
        : null,
      durationMins: analysis
        ? isLowEmission
          ? analysis.recommended.durationMins
          : analysis.highRisk.durationMins
        : null,
      recommendedTitle: analysis?.recommended.title ?? null,
      exposureAqi: analysis
        ? isLowEmission
          ? analysis.recommended.exposureAqi
          : analysis.highRisk.exposureAqi
        : null,
      co2SavedKg: analysis?.recommended.co2SavedKg ?? null,
    });
  }, [origin, destination, departureSlot, selectedMode, analysis, onSnapshotChange]);

  // Recalculate exposure / mode cards cleanly when departure slot or transport mode changes
  const handleSelectSlot = (slot: CommuteTimeSlot) => {
    setDepartureSlot(slot);
    void analyzeRoute({
      originText: origin,
      destinationText: destination,
      slot,
      mode: selectedMode,
      activeCity: city,
      resolvedOriginCoords: originCoords,
      resolvedDestCoords: destinationCoords,
    });
  };

  const handleSelectMode = (mode: CommuteMode) => {
    setSelectedMode(mode);
    void analyzeRoute({
      originText: origin,
      destinationText: destination,
      slot: departureSlot,
      mode,
      activeCity: city,
      resolvedOriginCoords: originCoords,
      resolvedDestCoords: destinationCoords,
    });
  };

  const handleRouteSubmit = (e: FormEvent) => {
    e.preventDefault();
    setActiveAutocomplete(null);
    void analyzeRoute({
      originText: origin,
      destinationText: destination,
      slot: departureSlot,
      mode: selectedMode,
      activeCity: city,
      resolvedOriginCoords: originCoords,
      resolvedDestCoords: destinationCoords,
    });
  };

  const handleSwapRoute = () => {
    const nextOrigin = destination;
    const nextDestination = origin;
    const nextOriginCoords = destinationCoords;
    const nextDestCoords = originCoords;
    setOrigin(nextOrigin);
    setDestination(nextDestination);
    setOriginCoords(nextOriginCoords);
    setDestinationCoords(nextDestCoords);
    setActiveAutocomplete(null);
    void analyzeRoute({
      originText: nextOrigin,
      destinationText: nextDestination,
      slot: departureSlot,
      mode: selectedMode,
      activeCity: city,
      resolvedOriginCoords: nextOriginCoords,
      resolvedDestCoords: nextDestCoords,
    });
  };

  const handlePickSuggestion = (field: 'origin' | 'destination', item: PhotonSuggestion) => {
    const nextCoords = { lat: item.lat, lng: item.lng };
    setActiveAutocomplete(null);
    setSuggestions([]);

    if (field === 'origin') {
      setOrigin(item.label);
      setOriginCoords(nextCoords);
      if (destination.trim()) {
        void analyzeRoute({
          originText: item.label,
          destinationText: destination,
          slot: departureSlot,
          mode: selectedMode,
          activeCity: city,
          resolvedOriginCoords: nextCoords,
          resolvedDestCoords: destinationCoords,
        });
      }
    } else {
      setDestination(item.label);
      setDestinationCoords(nextCoords);
      if (origin.trim()) {
        void analyzeRoute({
          originText: origin,
          destinationText: item.label,
          slot: departureSlot,
          mode: selectedMode,
          activeCity: city,
          resolvedOriginCoords: originCoords,
          resolvedDestCoords: nextCoords,
        });
      }
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

  // Errand & Trip Bundler derived impact metrics (memoized pure utility)
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

  // Compute Apple Health Ring metrics from habit swaps & Family vs 500 Homes scale (memoized)
  const habitMetrics = useMemo(
    () => calculateHabitSimulatorImpact(habits, scale),
    [habits, scale]
  );
  const activeHabitsCount = habitMetrics.activeCount;
  const lungShieldPct = habitMetrics.lungShieldPct;
  const displayCleanHours = habitMetrics.displayCleanHours;
  const displayCo2Kg = habitMetrics.displayCo2Kg;
  const lungRingProgress = habitMetrics.lungRingProgress;
  const cleanHoursProgress = habitMetrics.cleanHoursProgress;
  const co2Progress = habitMetrics.co2Progress;
  const colonyCo2WeeklyKg = habitMetrics.colonyCo2WeeklyKg;
  const carsOffRoad = habitMetrics.carsOffRoad;

  const whatsappPreviewMessage = useMemo(
    () =>
      buildWhatsAppBroadcastMessage({
        city,
        language: whatsappLang,
        colonyCo2WeeklyKg,
        carsOffRoad,
      }),
    [city, whatsappLang, colonyCo2WeeklyKg, carsOffRoad]
  );

  const handleCopyWhatsApp = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(whatsappPreviewMessage);
      }
    } catch {
      // Clipboard fallback
    }

    setCopiedWhatsApp(true);
    onShowToast(
      whatsappLang === 'hi'
        ? `हिंदी WhatsApp अलर्ट कॉपी हो गया (${city.colonyName})`
        : `WhatsApp alert copied for ${city.colonyName} RWA`
    );
    window.setTimeout(() => setCopiedWhatsApp(false), 2200);
  };

  // SVG Ring Geometry
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
    <div className="space-y-6 pb-32">
      {/* TOP HALF: Smart Commute Advisor with Interactive Google Route Map */}
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
            onSubmit={handleRouteSubmit}
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
                  setOrigin(e.target.value);
                  setOriginCoords(null);
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
              onClick={handleSwapRoute}
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
                  setDestination(e.target.value);
                  setDestinationCoords(null);
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
                onClick={() =>
                  void analyzeRoute({
                    originText: origin,
                    destinationText: destination,
                    slot: departureSlot,
                    mode: selectedMode,
                    activeCity: city,
                    resolvedOriginCoords: originCoords,
                    resolvedDestCoords: destinationCoords,
                  })
                }
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
                  onClick={() => handleSelectSlot(slot.id)}
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
                  onClick={() => handleSelectMode(m.id)}
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

        {/* Interactive Errand & Trip Bundler Card */}
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
                key={`bundle-${bundledCount}-${city.safeWindowLabel}`}
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
                      {city.safeWindowLabel}
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
      </section>

      {/* BOTTOM HALF: Choice-to-Impact Simulator (7 Left / 5 Right) */}
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
                    onClick={() => setScale(opt.id)}
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
                            transition:
                              'stroke-dashoffset 620ms cubic-bezier(0.16, 1, 0.3, 1)',
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

          {/* Bottom Colony Ripple + WhatsApp Colony Alert Preview (English | हिंदी) */}
          <div className="space-y-3 pt-2">
            <div className="rounded-2xl bg-slate-100/90 px-4 py-2.5 text-center text-[12px] font-bold text-[#0F172A] ring-1 ring-slate-200/80">
              Colony Ripple: Equivalent to taking{' '}
              <span className="text-[#15803D]">
                <AnimatedNumber value={carsOffRoad} /> cars
              </span>{' '}
              off the road
            </div>

            {/* Compact Frosted WhatsApp Colony / RWA Broadcast Preview with EN | हिंदी Toggle */}
            <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-3.5 shadow-2xs backdrop-blur-xl">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <div
                  role="tablist"
                  aria-label="Colony alert language"
                  className="inline-flex items-center rounded-full bg-slate-200/70 p-0.5"
                >
                  {(
                    [
                      { id: 'en', label: 'English' },
                      { id: 'hi', label: 'हिंदी' },
                    ] as const
                  ).map((opt) => {
                    const active = whatsappLang === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChangeWhatsappLang(opt.id)}
                        className={`apple-press relative rounded-full px-3 py-1 text-[11.5px] font-bold transition-colors ${
                          active ? 'text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="commuteWhatsappLangPill"
                            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                            className="absolute inset-0 rounded-full bg-white shadow-xs"
                          />
                        )}
                        <span className="relative z-10">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={onOpenWhatsappModal}
                  className="apple-press inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#334155] hover:bg-slate-200/80 hover:text-[#0F172A]"
                >
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  <span>Full Preview</span>
                </button>
              </div>

              <div className="mb-3 max-h-28 overflow-y-auto rounded-xl border border-[#34C759]/20 bg-[#34C759]/[0.05] px-3 py-2">
                <pre className="whitespace-pre-wrap font-sans text-[11.5px] font-medium leading-relaxed text-[#1E293B] tabular-nums-strict">
                  {whatsappPreviewMessage}
                </pre>
              </div>

              <button
                type="button"
                onClick={() => void handleCopyWhatsApp()}
                className="apple-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 font-display text-[13.5px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(52,199,89,0.6)] hover:bg-[#2DB84F]"
              >
                {copiedWhatsApp ? (
                  <>
                    <Check className="h-4.5 w-4.5 stroke-[2.6]" aria-hidden="true" />
                    {whatsappLang === 'hi'
                      ? `कॉपी हो गया — ${city.colonyName}`
                      : `Copied Alert for ${city.colonyName}`}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {whatsappLang === 'hi'
                      ? 'हिंदी WhatsApp अलर्ट कॉपी करें'
                      : 'Copy WhatsApp Alert for Colony / RWA'}
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

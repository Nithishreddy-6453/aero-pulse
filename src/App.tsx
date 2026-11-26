import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FloatingCopilot } from './components/FloatingCopilot';
import { SevereSmogBanner } from './components/SevereSmogBanner';
import { TabErrorBoundary } from './components/TabErrorBoundary';
import { TodayTab } from './components/TodayTab';
import { TopNavbar } from './components/TopNavbar';
import { WhatsAppAlertModal, WhatsAppLanguage } from './components/WhatsAppAlertModal';

import {
  applyLiveAirQualityToCity,
  createDynamicIndianCity,
  INDIAN_CITIES,
  INITIAL_HABIT_SWAPS,
  INITIAL_INDOOR_HACKS,
} from './data/indianCities';
import { fetchLiveAirQuality, reverseGeocodeIndianCoords } from './services/airQuality';
import { clearAdvisoryCacheForCity, fetchTodayAdvisory } from './services/gemini';
import {
  AeroTab,
  CityAirProfile,
  CommuteLiveSnapshot,
  ExternalMapRouteRequest,
  HabitSwap,
  IndianCitySearchResult,
  IndoorHack,
  LiveAppContext,
  PersonaId,
  QuickModifier,
  RoomAuditLiveSnapshot,
  RoomVisionTrap,
  TodayAdvisoryPayload,
} from './types/aeropulse';
import { calculateHabitSimulatorImpact } from './utils/impactCalc';
import {
  extractCustomCityMetadata,
  hydrateHabits,
  hydrateHacks,
  loadPersistedState,
  savePersistedState,
} from './utils/storage';

const RoomAuditTab = lazy(() =>
  import('./components/RoomAuditTab').then((m) => ({ default: m.RoomAuditTab }))
);
const CommuteImpactTab = lazy(() =>
  import('./components/CommuteImpactTab').then((m) => ({ default: m.CommuteImpactTab }))
);

function TabSkeletonFallback({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading ${label}`}
      className="space-y-6 pb-32"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <div className="h-10 w-28 animate-pulse rounded-full bg-white/80 ring-1 ring-slate-200/70" />
          <div className="h-10 w-24 animate-pulse rounded-full bg-white/80 ring-1 ring-slate-200/70" />
          <div className="h-10 w-32 animate-pulse rounded-full bg-white/80 ring-1 ring-slate-200/70" />
        </div>
        <div className="h-9 w-40 animate-pulse rounded-full bg-white/80 ring-1 ring-slate-200/70" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="glass-card h-[420px] animate-pulse rounded-3xl p-6 lg:col-span-7">
          <div className="h-full w-full rounded-2xl bg-slate-200/60" />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <div className="glass-card h-44 animate-pulse rounded-3xl p-6" />
          <div className="glass-card h-28 animate-pulse rounded-3xl p-6" />
          <div className="glass-card h-28 animate-pulse rounded-3xl p-6" />
        </div>
      </div>
    </div>
  );
}

const PRESET_CITY_IDS = new Set(INDIAN_CITIES.map((c) => c.id));
const DEFAULT_SELECTED_ERRANDS = ['Groceries', 'Pharmacy'];

const PERSONA_LABELS: Record<PersonaId, string> = {
  parent: 'Parent with Kids',
  senior: 'Senior Citizen',
  commuter: 'Office Commuter',
  student: 'Student',
};

const TAB_LABELS: Record<AeroTab, LiveAppContext['activeTab']> = {
  today: 'Today',
  'room-audit': 'Room Audit',
  commute: 'Commute & Impact',
};

type AtmosphereTone = 'neutral' | 'good' | 'moderate' | 'poor';

function getAtmosphereTone(aqi: number, isLive: boolean): AtmosphereTone {
  if (!isLive) return 'neutral';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  return 'poor';
}

const ATMOSPHERE_LAYERS: Record<AtmosphereTone, string> = {
  neutral:
    'radial-gradient(ellipse 90% 60% at 15% -5%, rgba(186, 230, 253, 0.42), transparent 62%), radial-gradient(ellipse 80% 55% at 88% 8%, rgba(203, 213, 225, 0.42), transparent 64%), linear-gradient(180deg, #EFF5FC 0%, #F7FAFD 52%, #F3F6FA 100%)',
  good:
    'radial-gradient(ellipse 90% 62% at 14% -8%, rgba(96, 185, 255, 0.42), transparent 62%), radial-gradient(ellipse 82% 55% at 88% 0%, rgba(165, 224, 255, 0.48), transparent 64%), radial-gradient(ellipse 75% 48% at 50% 98%, rgba(219, 242, 255, 0.56), transparent 70%), linear-gradient(180deg, #DCEFFE 0%, #EFF8FF 48%, #FBFEFF 100%)',
  moderate:
    'radial-gradient(ellipse 90% 62% at 14% -6%, rgba(245, 206, 138, 0.46), transparent 62%), radial-gradient(ellipse 82% 55% at 86% 4%, rgba(196, 209, 224, 0.48), transparent 64%), radial-gradient(ellipse 75% 48% at 52% 98%, rgba(238, 229, 210, 0.52), transparent 70%), linear-gradient(180deg, #F6E9D2 0%, #F6F3EC 48%, #EDF1F6 100%)',
  poor:
    'radial-gradient(ellipse 90% 62% at 16% -6%, rgba(208, 138, 118, 0.44), transparent 62%), radial-gradient(ellipse 82% 56% at 84% 6%, rgba(168, 182, 200, 0.48), transparent 64%), radial-gradient(ellipse 75% 50% at 48% 98%, rgba(218, 198, 191, 0.48), transparent 70%), linear-gradient(180deg, #EEDAD2 0%, #EFEAE7 48%, #E6EBF1 100%)',
};

function matchPresetCityId(detectedCity: string): string | null {
  const norm = detectedCity.toLowerCase();
  if (/delhi|new delhi|gurgaon|gurugram|noida|faridabad|ghaziabad/.test(norm)) {
    return 'new-delhi';
  }
  if (/bhubaneswar|cuttack|khordha/.test(norm)) {
    return 'bhubaneswar';
  }
  if (/mumbai|bombay|thane|navi mumbai|bandra|andheri/.test(norm)) {
    return 'mumbai';
  }
  if (/bengaluru|bangalore/.test(norm)) {
    return 'bengaluru';
  }
  if (/kolkata|calcutta|howrah|salt lake|bidhannagar/.test(norm)) {
    return 'kolkata';
  }
  if (/lucknow/.test(norm)) {
    return 'lucknow';
  }
  if (/hyderabad|secunderabad|cyberabad|gachibowli/.test(norm)) {
    return 'hyderabad';
  }
  if (/chennai|madras/.test(norm)) {
    return 'chennai';
  }
  return null;
}

export default function App() {
  // Hydrate persistent user preferences & progress once from localStorage (never restoring stale AQI)
  const initialSavedRef = useRef<ReturnType<typeof loadPersistedState> | undefined>(undefined);
  if (initialSavedRef.current === undefined) {
    initialSavedRef.current = loadPersistedState();
  }
  const initialSaved = initialSavedRef.current;

  const [cities, setCities] = useState<CityAirProfile[]>(() => {
    const custom = initialSaved?.customCity;
    if (custom && !PRESET_CITY_IDS.has(custom.id)) {
      const restored = createDynamicIndianCity({
        id: custom.id,
        name: custom.name,
        state: custom.state,
        lat: custom.lat,
        lng: custom.lng,
      });
      return [
        {
          ...restored,
          defaultOrigin: custom.defaultOrigin || restored.defaultOrigin,
          defaultDestination: custom.defaultDestination || restored.defaultDestination,
          colonyName: custom.colonyName || restored.colonyName,
        },
        ...INDIAN_CITIES,
      ];
    }
    return INDIAN_CITIES;
  });

  const [selectedCityId, setSelectedCityId] = useState<string>(() => {
    const savedId = initialSaved?.selectedCityId;
    if (savedId && (PRESET_CITY_IDS.has(savedId) || initialSaved?.customCity?.id === savedId)) {
      return savedId;
    }
    return INDIAN_CITIES[0].id;
  });

  const [activeTab, setActiveTab] = useState<AeroTab>('today');
  const [persona, setPersona] = useState<PersonaId>(() => initialSaved?.persona ?? 'parent');
  const [modifiers, setModifiers] = useState<QuickModifier[]>(
    () => initialSaved?.modifiers ?? ['asthma']
  );
  const [completedRoutineMap, setCompletedRoutineMap] = useState<Record<string, string[]>>(
    () => initialSaved?.completedRoutineMap ?? {}
  );
  const completedRoutineMapRef = useRef(completedRoutineMap);
  completedRoutineMapRef.current = completedRoutineMap;
  const [hacks, setHacks] = useState<IndoorHack[]>(() =>
    hydrateHacks(INITIAL_INDOOR_HACKS, initialSaved)
  );
  const [habits, setHabits] = useState<HabitSwap[]>(() =>
    hydrateHabits(INITIAL_HABIT_SWAPS, initialSaved)
  );
  const [addedRoutinePinIds, setAddedRoutinePinIds] = useState<string[]>(
    () => initialSaved?.addedRoutinePinIds ?? []
  );
  const [severeProtocolChecks, setSevereProtocolChecks] = useState<string[]>(
    () => initialSaved?.severeProtocolChecks ?? []
  );
  const [whatsappLang, setWhatsappLang] = useState<WhatsAppLanguage>(
    () => initialSaved?.whatsappLang ?? 'en'
  );
  const [isWhatsappModalOpen, setIsWhatsappModalOpen] = useState(false);
  const [selectedErrands, setSelectedErrands] = useState<string[]>(
    () => initialSaved?.bundledErrands ?? DEFAULT_SELECTED_ERRANDS
  );
  const [customErrands, setCustomErrands] = useState<string[]>(
    () => initialSaved?.customErrands ?? []
  );

  // Cross-tab live snapshots synced into the global Ask AeroPulse Copilot
  const [roomAuditSnapshot, setRoomAuditSnapshot] = useState<RoomAuditLiveSnapshot | null>(null);
  const [commuteSnapshot, setCommuteSnapshot] = useState<CommuteLiveSnapshot | null>(null);
  const [pendingMapRoute, setPendingMapRoute] = useState<ExternalMapRouteRequest | null>(null);

  // Live Open-Meteo sync state
  const [isLocating, setIsLocating] = useState(false);
  const [isSyncingAqi, setIsSyncingAqi] = useState(false);
  const [liveAqiError, setLiveAqiError] = useState<string | null>(null);
  const [lastSyncedLabel, setLastSyncedLabel] = useState('Syncing...');

  // Context-aware Gemini Advisory state cached by (city + persona + modifiers)
  const [advisoryCache, setAdvisoryCache] = useState<Record<string, TodayAdvisoryPayload>>({});
  const [isLoadingAdvisory, setIsLoadingAdvisory] = useState(false);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);
  const [advisoryNonce, setAdvisoryNonce] = useState(0);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const aqiFetchSeqRef = useRef(0);
  const advisoryFetchSeqRef = useRef(0);

  const selectedCity = useMemo(
    () => cities.find((c) => c.id === selectedCityId) ?? cities[0],
    [cities, selectedCityId]
  );

  const modifiersKey = useMemo(() => modifiers.slice().sort().join(','), [modifiers]);
  const advisoryCacheKey = `${selectedCity.id}|${persona}|${modifiersKey}`;
  const activeAdvisory = advisoryCache[advisoryCacheKey] ?? null;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  // Fetch live Open-Meteo Air Quality telemetry for any city coordinates (with client TTL cache)
  const fetchLiveAqi = useCallback(
    async (
      cityId: string,
      lat: number,
      lng: number,
      options?: { forceRefresh?: boolean; toastCityName?: string }
    ) => {
      const seq = ++aqiFetchSeqRef.current;
      setIsSyncingAqi(true);
      setLiveAqiError(null);

      try {
        const liveData = await fetchLiveAirQuality(lat, lng, {
          forceRefresh: options?.forceRefresh,
        });

        if (seq !== aqiFetchSeqRef.current) return;

        setCities((prev) =>
          prev.map((c) => (c.id === cityId ? applyLiveAirQualityToCity(c, liveData) : c))
        );
        setLastSyncedLabel(liveData.fetchedAtLabel);

        if (options?.forceRefresh) {
          clearAdvisoryCacheForCity(cityId);
          setAdvisoryCache((prev) => {
            const next: Record<string, TodayAdvisoryPayload> = {};
            for (const [k, v] of Object.entries(prev)) {
              if (!k.startsWith(`${cityId}|`)) next[k] = v;
            }
            return next;
          });
          setAdvisoryNonce((n) => n + 1);
          if (options.toastCityName) {
            showToast(
              `Synced live Open-Meteo AQI for ${options.toastCityName}: ${liveData.aqi} US AQI`
            );
          }
        }
      } catch (err) {
        if (seq !== aqiFetchSeqRef.current) return;
        setLiveAqiError(
          err instanceof Error
            ? err.message
            : 'Unable to reach live Open-Meteo Air Quality API. Tap retry.'
        );
      } finally {
        if (seq === aqiFetchSeqRef.current) {
          setIsSyncingAqi(false);
        }
      }
    },
    [showToast]
  );

  // Trigger live Open-Meteo fetch automatically whenever selected city changes (if not yet live)
  useEffect(() => {
    if (!selectedCity.isLive) {
      void fetchLiveAqi(selectedCity.id, selectedCity.center.lat, selectedCity.center.lng);
    } else if (selectedCity.fetchedAtLabel) {
      setLastSyncedLabel(selectedCity.fetchedAtLabel);
    }
  }, [
    selectedCity.id,
    selectedCity.isLive,
    selectedCity.center.lat,
    selectedCity.center.lng,
    selectedCity.fetchedAtLabel,
    fetchLiveAqi,
  ]);

  // Trigger Context-Aware Gemini Hero Verdict & Routine when live AQI loads or persona/risk chips change
  useEffect(() => {
    if (!selectedCity.isLive) return;
    if (advisoryCache[advisoryCacheKey]) {
      setAdvisoryError(null);
      setIsLoadingAdvisory(false);
      return;
    }

    const seq = ++advisoryFetchSeqRef.current;
    const controller = new AbortController();
    setIsLoadingAdvisory(true);
    setAdvisoryError(null);

    const run = async () => {
      try {
        const data = await fetchTodayAdvisory({
          cityId: selectedCity.id,
          city: selectedCity.name,
          state: selectedCity.state,
          aqi: selectedCity.aqi,
          severityLabel: selectedCity.severityLabel,
          pm25: selectedCity.pm25,
          pm10: selectedCity.pm10,
          no2: selectedCity.no2,
          o3: selectedCity.o3,
          bestWindow: selectedCity.safeWindowLabel,
          persona,
          modifiers,
          forceRefresh: advisoryNonce > 0,
          signal: controller.signal,
        });

        if (seq !== advisoryFetchSeqRef.current || controller.signal.aborted) return;

        const savedCompletedIds = new Set(completedRoutineMapRef.current[advisoryCacheKey] ?? []);
        const payload: TodayAdvisoryPayload = {
          heroVerdict: data.heroVerdict,
          asthmaTip: data.asthmaTip || '',
          gasStoveTip: data.gasStoveTip || '',
          routines: data.routines.map((r) => ({
            ...r,
            completed: savedCompletedIds.has(r.id) ? true : Boolean(r.completed),
          })),
          modelUsed: data.modelUsed,
        };

        setAdvisoryCache((prev) => ({
          ...prev,
          [advisoryCacheKey]: payload,
        }));
      } catch (err) {
        if (seq !== advisoryFetchSeqRef.current || controller.signal.aborted) return;
        setAdvisoryError(
          err instanceof Error
            ? err.message
            : 'Unable to reach Gemini advisory service. Tap retry.'
        );
      } finally {
        if (seq === advisoryFetchSeqRef.current && !controller.signal.aborted) {
          setIsLoadingAdvisory(false);
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [
    selectedCity.isLive,
    selectedCity.id,
    selectedCity.name,
    selectedCity.state,
    selectedCity.aqi,
    selectedCity.severityLabel,
    selectedCity.pm25,
    selectedCity.pm10,
    selectedCity.no2,
    selectedCity.o3,
    selectedCity.safeWindowLabel,
    persona,
    modifiers,
    advisoryCacheKey,
    advisoryCache,
    advisoryNonce,
  ]);

  const handleSelectCity = (cityId: string) => {
    setSelectedCityId(cityId);
    const target = cities.find((c) => c.id === cityId);
    if (target && !target.isLive) {
      void fetchLiveAqi(target.id, target.center.lat, target.center.lng);
    } else if (target?.fetchedAtLabel) {
      setLastSyncedLabel(target.fetchedAtLabel);
    }
  };

  // Select any Indian city from Open-Meteo Geocoding search
  const handleSelectSearchedCity = (place: IndianCitySearchResult) => {
    const existingPresetId = matchPresetCityId(place.name);
    const existingById = cities.find(
      (c) =>
        c.id === place.id ||
        (existingPresetId && c.id === existingPresetId) ||
        c.name.toLowerCase() === place.name.toLowerCase()
    );

    if (existingById) {
      setSelectedCityId(existingById.id);
      void fetchLiveAqi(existingById.id, existingById.center.lat, existingById.center.lng);
      showToast(`Loading live Open-Meteo AQI for ${existingById.name}`);
      return;
    }

    const dynamicCity = createDynamicIndianCity({
      id: place.id,
      name: place.name,
      state: place.state,
      lat: place.lat,
      lng: place.lng,
    });

    setCities((prev) => [dynamicCity, ...prev]);
    setSelectedCityId(dynamicCity.id);
    void fetchLiveAqi(dynamicCity.id, place.lat, place.lng);
    showToast(`Loading live Open-Meteo AQI for ${place.name}, ${place.state}`);
  };

  // Browser Geolocation + OpenStreetMap Nominatim Reverse Geocoding + Live Open-Meteo AQI
  const handleLocateGps = () => {
    if (!navigator.geolocation) {
      showToast('Browser geolocation is unavailable on this device.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;

        try {
          const data = await reverseGeocodeIndianCoords(lat, lng);

          const matchedId = matchPresetCityId(data.city);
          if (matchedId) {
            setCities((prev) =>
              prev.map((c) =>
                c.id === matchedId
                  ? {
                      ...c,
                      center: { lat, lng },
                      isLive: false,
                      defaultOrigin: data.locality
                        ? `${data.locality}, ${data.city}`
                        : c.defaultOrigin,
                    }
                  : c
              )
            );
            setSelectedCityId(matchedId);
            await fetchLiveAqi(matchedId, lat, lng, { forceRefresh: true });
            showToast(
              `Located ${data.locality ? `${data.locality}, ` : ''}${data.city} • Live AQI synced`
            );
          } else {
            const detectedId = `gps-${data.city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const detectedProfile = createDynamicIndianCity({
              id: detectedId,
              name: data.city,
              state: data.state || 'India',
              lat,
              lng,
              locality: data.locality,
            });

            setCities((prev) => {
              const withoutOld = prev.filter((c) => !c.id.startsWith('gps-'));
              return [detectedProfile, ...withoutOld];
            });
            setSelectedCityId(detectedId);
            await fetchLiveAqi(detectedId, lat, lng, { forceRefresh: true });
            showToast(
              `Located ${data.locality ? `${data.locality}, ` : ''}${data.city} • Live AQI synced`
            );
          }
        } catch (err) {
          showToast(
            err instanceof Error
              ? err.message
              : 'Unable to reach reverse geocoding service.'
          );
        } finally {
          setIsLocating(false);
        }
      },
      (geoError) => {
        setIsLocating(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          showToast('Location permission denied — search or pick your Indian city.');
        } else {
          showToast('Could not read GPS position — try again or search your city.');
        }
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 }
    );
  };

  const handleRefreshSync = () => {
    void fetchLiveAqi(selectedCity.id, selectedCity.center.lat, selectedCity.center.lng, {
      forceRefresh: true,
      toastCityName: selectedCity.name,
    });
  };

  const handleRetryAdvisory = () => {
    setAdvisoryCache((prev) => {
      const next = { ...prev };
      delete next[advisoryCacheKey];
      return next;
    });
    setAdvisoryNonce((n) => n + 1);
  };

  const handleToggleModifier = (mod: QuickModifier) => {
    setModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  };

  const handleToggleRoutine = (id: string) => {
    const current = advisoryCache[advisoryCacheKey];
    if (!current) return;
    const updatedRoutines = current.routines.map((r) =>
      r.id === id ? { ...r, completed: !r.completed } : r
    );
    const completedIds = updatedRoutines.filter((r) => r.completed).map((r) => r.id);

    setAdvisoryCache((prev) => ({
      ...prev,
      [advisoryCacheKey]: {
        ...current,
        routines: updatedRoutines,
      },
    }));
    setCompletedRoutineMap((prevMap) => ({
      ...prevMap,
      [advisoryCacheKey]: completedIds,
    }));
  };

  const handleToggleHack = (id: string) => {
    setHacks((prev) =>
      prev.map((h) => (h.id === id ? { ...h, completed: !h.completed } : h))
    );
  };

  const handleToggleAddVisionFix = (
    fixKey: string,
    roomLabel: string,
    trap: RoomVisionTrap
  ) => {
    const hackId = `room-audit-${fixKey}`;

    if (addedRoutinePinIds.includes(fixKey)) {
      setAddedRoutinePinIds((prev) => prev.filter((k) => k !== fixKey));
      setHacks((prev) => prev.filter((h) => h.id !== hackId));
      showToast(`Removed "${trap.title}" from Indoor Air Quality Hacks`);
    } else {
      setAddedRoutinePinIds((prev) => [...prev, fixKey]);
      const budget: IndoorHack['budget'] =
        trap.category === 'Free' ? 'free' : trap.category === 'DIY' ? 'diy' : 'smart';

      const newHack: IndoorHack = {
        id: hackId,
        title: trap.fixAction,
        budget,
        priceLabel: trap.costBadge,
        impactPill: trap.title,
        whyText: trap.whyImpact,
        completed: false,
        source: 'room-audit',
        auditRoomLabel: roomLabel,
      };
      setHacks((prev) => [newHack, ...prev]);
      showToast(`Added "${trap.title}" to Indoor Air Quality Hacks`);
    }
  };

  const handleToggleHabit = (id: string) => {
    setHabits((prev) =>
      prev.map((h) => (h.id === id ? { ...h, enabled: !h.enabled } : h))
    );
  };

  const handleChangeHabitDays = (id: string, days: number) => {
    setHabits((prev) =>
      prev.map((h) => (h.id === id ? { ...h, daysPerWeek: days } : h))
    );
  };

  const handleToggleSevereCheck = (id: string) => {
    setSevereProtocolChecks((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleErrand = (errand: string) => {
    setSelectedErrands((prev) =>
      prev.includes(errand) ? prev.filter((e) => e !== errand) : [...prev, errand]
    );
  };

  const handleAddCustomErrand = (rawErrand: string) => {
    const clean = rawErrand.trim();
    if (!clean) return;
    setCustomErrands((prev) =>
      prev.some((e) => e.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
    setSelectedErrands((prev) =>
      prev.some((e) => e.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
  };

  const handleRemoveCustomErrand = (errand: string) => {
    setCustomErrands((prev) => prev.filter((e) => e !== errand));
    setSelectedErrands((prev) => prev.filter((e) => e !== errand));
  };

  // Persist user selections & progress to localStorage cleanly (never storing stale AQI numbers)
  useEffect(() => {
    const hackCompletedMap: Record<string, boolean> = {};
    const roomAuditHacks: IndoorHack[] = [];
    for (const h of hacks) {
      if (h.source === 'room-audit') {
        roomAuditHacks.push(h);
      } else {
        hackCompletedMap[h.id] = h.completed;
      }
    }

    savePersistedState({
      selectedCityId,
      customCity: extractCustomCityMetadata(selectedCity, PRESET_CITY_IDS),
      persona,
      modifiers,
      completedRoutineMap,
      hackCompletedMap,
      roomAuditHacks,
      addedRoutinePinIds,
      habitStates: habits.map((h) => ({
        id: h.id,
        enabled: h.enabled,
        daysPerWeek: h.daysPerWeek,
      })),
      severeProtocolChecks,
      whatsappLang,
      bundledErrands: selectedErrands,
      customErrands,
    });
  }, [
    selectedCityId,
    selectedCity,
    persona,
    modifiers,
    completedRoutineMap,
    hacks,
    addedRoutinePinIds,
    habits,
    severeProtocolChecks,
    whatsappLang,
    selectedErrands,
    customErrands,
  ]);

  // Live colony metrics for the global WhatsApp Alert Modal (accessible from Severe Smog Banner & Commute Tab)
  const { colonyCo2WeeklyKg, carsOffRoad } = useMemo(() => {
    const metrics = calculateHabitSimulatorImpact(habits, 'colony');
    return {
      colonyCo2WeeklyKg: metrics.colonyCo2WeeklyKg,
      carsOffRoad: metrics.carsOffRoad,
    };
  }, [habits]);

  // Interactive Chat-to-Map Navigation: switch to Commute & Impact, fill inputs, and plot immediately
  const handleOpenMapRoute = useCallback(
    (origin: string, destination: string) => {
      const cleanOrigin = origin.trim();
      const cleanDest = destination.trim();
      if (!cleanOrigin || !cleanDest) return;
      setPendingMapRoute({
        origin: cleanOrigin,
        destination: cleanDest,
        requestId: Date.now(),
      });
      setActiveTab('commute');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(`Plotting route: ${cleanOrigin} → ${cleanDest}`);
    },
    [showToast]
  );

  const handleExternalRouteHandled = useCallback(() => {
    setPendingMapRoute(null);
  }, []);

  // Real-Time Global Context Bundler for the Multi-Turn Gemini Copilot
  const getLiveAppContext = useCallback((): LiveAppContext => {
    const riskSet = new Set<string>();
    if (modifiers.includes('asthma')) riskSet.add('Asthma');
    if (modifiers.includes('gasStove')) riskSet.add('Gas Stove');
    if (roomAuditSnapshot?.riskFlags.includes('gasStove')) riskSet.add('Gas Stove');
    if (roomAuditSnapshot?.riskFlags.includes('mainRoad')) riskSet.add('Near Main Road');
    if (roomAuditSnapshot?.riskFlags.includes('noPurifier')) riskSet.add('No Purifier');

    const addedRoomAuditFixes = hacks
      .filter((h) => h.source === 'room-audit')
      .map((h) => `${h.impactPill}: ${h.title} (${h.priceLabel})`);

    const hourlySummary = selectedCity.hourlyTimeline
      .map((slot) => `${slot.shortLabel}: ${slot.aqi}`)
      .join(', ');

    const diag = roomAuditSnapshot?.diagnosis ?? null;

    return {
      activeTab: TAB_LABELS[activeTab],
      telemetry: {
        city: selectedCity.name,
        state: selectedCity.state,
        aqi: selectedCity.aqi,
        severityLabel: selectedCity.severityLabel,
        pm25: selectedCity.pm25,
        pm10: selectedCity.pm10,
        no2: selectedCity.no2,
        o3: selectedCity.o3,
        safeWindowLabel: selectedCity.safeWindowLabel,
        hourlySummary,
        isLive: selectedCity.isLive,
      },
      profile: {
        personaId: persona,
        personaLabel: PERSONA_LABELS[persona],
        riskChips: Array.from(riskSet),
      },
      roomAudit: diag
        ? {
            roomLabel: roomAuditSnapshot?.roomLabel || 'Room',
            riskLevel: diag.riskLevel,
            fixPotentialPercent: diag.fixPotentialPercent,
            traps: diag.traps.map((t) => ({
              id: t.id,
              title: t.title,
              category: t.category,
              costBadge: t.costBadge,
              fixAction: t.fixAction,
              whyImpact: t.whyImpact,
            })),
            addedFixes: addedRoomAuditFixes,
          }
        : null,
      commute: commuteSnapshot
        ? {
            origin: commuteSnapshot.origin,
            destination: commuteSnapshot.destination,
            distanceKm: commuteSnapshot.distanceKm,
            durationMins: commuteSnapshot.durationMins,
            selectedMode: commuteSnapshot.selectedMode,
            departureSlot: commuteSnapshot.departureSlot,
            recommendedTitle: commuteSnapshot.recommendedTitle,
            exposureAqi: commuteSnapshot.exposureAqi,
            co2SavedKg: commuteSnapshot.co2SavedKg,
          }
        : null,
      activeHabits: habits
        .filter((h) => h.enabled)
        .map((h) => ({
          title: h.title,
          daysPerWeek: h.daysPerWeek,
          tag: h.tag,
        })),
    };
  }, [activeTab, selectedCity, persona, modifiers, roomAuditSnapshot, commuteSnapshot, hacks, habits]);

  const atmosphereTone = getAtmosphereTone(selectedCity.aqi, selectedCity.isLive);

  return (
    <div className="relative min-h-screen text-[#0F172A]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#0F172A] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#007AFF]"
      >
        Skip to main content
      </a>
      {/* Live GPU-Accelerated Apple Weather Ambient Atmospheric Canvas */}
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        {(Object.keys(ATMOSPHERE_LAYERS) as AtmosphereTone[]).map((tone) => (
          <div
            key={tone}
            className={`absolute inset-0 transition-opacity duration-700 ease-out will-change-[opacity] ${
              atmosphereTone === tone ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ background: ATMOSPHERE_LAYERS[tone] }}
          />
        ))}
      </div>

      {/* Sticky 3-Zone Frosted Top Navbar */}
      <TopNavbar
        cities={cities}
        selectedCity={selectedCity}
        onSelectCity={handleSelectCity}
        onSelectSearchedCity={handleSelectSearchedCity}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLocateGps={handleLocateGps}
        isLocating={isLocating}
        isSyncingAqi={isSyncingAqi}
        lastSyncedLabel={lastSyncedLabel}
        onRefreshSync={handleRefreshSync}
      />

      {/* Auto-Triggered Severe Smog Emergency Banner (Strictly AQI >= 300) */}
      <SevereSmogBanner
        city={selectedCity}
        checkedIds={severeProtocolChecks}
        onToggleCheck={handleToggleSevereCheck}
        onAlertFamily={() => setIsWhatsappModalOpen(true)}
      />

      {/* Frosted Apple Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            className="fixed left-1/2 top-20 z-50 -translate-x-1/2"
          >
            <div className="glass-floating inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#0F172A]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#34C759]" aria-hidden="true" />
              <span className="whitespace-nowrap">{toastMessage}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Container */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 mx-auto max-w-[1320px] px-4 pt-6 focus:outline-none sm:px-6 lg:px-8"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === 'today' && (
              <TabErrorBoundary sectionName="Today Dashboard">
                <TodayTab
                  city={selectedCity}
                  isLoadingLiveAqi={isSyncingAqi}
                  liveAqiError={liveAqiError}
                  onRetryLiveAqi={handleRefreshSync}
                  persona={persona}
                  onSelectPersona={setPersona}
                  modifiers={modifiers}
                  onToggleModifier={handleToggleModifier}
                  advisory={activeAdvisory}
                  isLoadingAdvisory={isLoadingAdvisory}
                  advisoryError={advisoryError}
                  onRetryAdvisory={handleRetryAdvisory}
                  onToggleRoutine={handleToggleRoutine}
                  hacks={hacks}
                  onToggleHack={handleToggleHack}
                />
              </TabErrorBoundary>
            )}

            {activeTab === 'room-audit' && (
              <TabErrorBoundary sectionName="Room Audit">
                <Suspense fallback={<TabSkeletonFallback label="Room Audit" />}>
                  <RoomAuditTab
                    city={selectedCity}
                    addedAuditFixKeys={addedRoutinePinIds}
                    onToggleAddVisionFix={handleToggleAddVisionFix}
                    onSnapshotChange={setRoomAuditSnapshot}
                  />
                </Suspense>
              </TabErrorBoundary>
            )}

            {activeTab === 'commute' && (
              <TabErrorBoundary sectionName="Commute & Impact">
                <Suspense fallback={<TabSkeletonFallback label="Commute & Impact" />}>
                  <CommuteImpactTab
                    city={selectedCity}
                    habits={habits}
                    onToggleHabit={handleToggleHabit}
                    onChangeHabitDays={handleChangeHabitDays}
                    onShowToast={showToast}
                    onSnapshotChange={setCommuteSnapshot}
                    externalRouteRequest={pendingMapRoute}
                    onExternalRouteHandled={handleExternalRouteHandled}
                    selectedErrands={selectedErrands}
                    customErrands={customErrands}
                    onToggleErrand={handleToggleErrand}
                    onAddCustomErrand={handleAddCustomErrand}
                    onRemoveCustomErrand={handleRemoveCustomErrand}
                    whatsappLang={whatsappLang}
                    onChangeWhatsappLang={setWhatsappLang}
                    onOpenWhatsappModal={() => setIsWhatsappModalOpen(true)}
                  />
                </Suspense>
              </TabErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global WhatsApp Colony / Family Alert Modal (English | हिंदी) */}
      <WhatsAppAlertModal
        isOpen={isWhatsappModalOpen}
        onClose={() => setIsWhatsappModalOpen(false)}
        city={selectedCity}
        language={whatsappLang}
        onChangeLanguage={setWhatsappLang}
        colonyCo2WeeklyKg={colonyCo2WeeklyKg}
        carsOffRoad={carsOffRoad}
        onShowToast={showToast}
      />

      {/* Global Multi-Turn "Ask AeroPulse" AI Copilot synced across all 3 tabs */}
      <FloatingCopilot
        activeTab={activeTab}
        city={selectedCity}
        persona={persona}
        personaLabel={PERSONA_LABELS[persona]}
        getLiveAppContext={getLiveAppContext}
        onOpenMapRoute={handleOpenMapRoute}
      />
    </div>
  );
}

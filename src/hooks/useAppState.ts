import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhatsAppLanguage } from '../components/WhatsAppAlertModal';
import { INITIAL_HABIT_SWAPS, INITIAL_INDOOR_HACKS } from '../data/indianCities';
import { clearAdvisoryCacheForCity, fetchTodayAdvisory } from '../services/gemini';
import {
  AeroTab,
  CommuteLiveSnapshot,
  ExternalMapRouteRequest,
  HabitSwap,
  IndoorHack,
  LiveAppContext,
  PersonaId,
  QuickModifier,
  RoomAuditLiveSnapshot,
  RoomVisionTrap,
  TodayAdvisoryPayload,
} from '../types/aeropulse';
import { calculateHabitSimulatorImpact } from '../utils/impactCalc';
import {
  extractCustomCityMetadata,
  hydrateHabits,
  hydrateHacks,
  loadPersistedState,
  savePersistedState,
} from '../utils/storage';
import { PRESET_CITY_IDS, useAirQuality } from './useAirQuality';

const DEFAULT_SELECTED_ERRANDS = ['Groceries', 'Pharmacy'];

export const PERSONA_LABELS: Record<PersonaId, string> = {
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

export function useAppState() {
  // Hydrate persistent user preferences & progress once from localStorage (never restoring stale AQI)
  const initialSavedRef = useRef<ReturnType<typeof loadPersistedState> | undefined>(undefined);
  if (initialSavedRef.current === undefined) {
    initialSavedRef.current = loadPersistedState();
  }
  const initialSaved = initialSavedRef.current;

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

  // Context-aware Gemini Advisory state cached by (city + persona + modifiers)
  const [advisoryCache, setAdvisoryCache] = useState<Record<string, TodayAdvisoryPayload>>({});
  const [isLoadingAdvisory, setIsLoadingAdvisory] = useState(false);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);
  const [advisoryNonce, setAdvisoryNonce] = useState(0);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const advisoryFetchSeqRef = useRef(0);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  const handleForceRefreshCity = useCallback((cityId: string) => {
    clearAdvisoryCacheForCity(cityId);
    setAdvisoryCache((prev) => {
      const next: Record<string, TodayAdvisoryPayload> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(`${cityId}|`)) next[k] = v;
      }
      return next;
    });
    setAdvisoryNonce((n) => n + 1);
  }, []);

  const airQuality = useAirQuality({
    initialSaved,
    showToast,
    onForceRefreshCity: handleForceRefreshCity,
  });

  const { selectedCity, selectedCityId } = airQuality;

  const modifiersKey = useMemo(() => modifiers.slice().sort().join(','), [modifiers]);
  const advisoryCacheKey = `${selectedCity.id}|${persona}|${modifiersKey}`;
  const activeAdvisory = advisoryCache[advisoryCacheKey] ?? null;

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

  const handleRetryAdvisory = useCallback(() => {
    setAdvisoryCache((prev) => {
      const next = { ...prev };
      delete next[advisoryCacheKey];
      return next;
    });
    setAdvisoryNonce((n) => n + 1);
  }, [advisoryCacheKey]);

  const handleToggleModifier = useCallback((mod: QuickModifier) => {
    setModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }, []);

  const handleToggleRoutine = useCallback(
    (id: string) => {
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
    },
    [advisoryCache, advisoryCacheKey]
  );

  const handleToggleHack = useCallback((id: string) => {
    setHacks((prev) =>
      prev.map((h) => (h.id === id ? { ...h, completed: !h.completed } : h))
    );
  }, []);

  const handleToggleAddVisionFix = useCallback(
    (fixKey: string, roomLabel: string, trap: RoomVisionTrap) => {
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
    },
    [addedRoutinePinIds, showToast]
  );

  const handleToggleHabit = useCallback((id: string) => {
    setHabits((prev) =>
      prev.map((h) => (h.id === id ? { ...h, enabled: !h.enabled } : h))
    );
  }, []);

  const handleChangeHabitDays = useCallback((id: string, days: number) => {
    setHabits((prev) =>
      prev.map((h) => (h.id === id ? { ...h, daysPerWeek: days } : h))
    );
  }, []);

  const handleToggleSevereCheck = useCallback((id: string) => {
    setSevereProtocolChecks((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleToggleErrand = useCallback((errand: string) => {
    setSelectedErrands((prev) =>
      prev.includes(errand) ? prev.filter((e) => e !== errand) : [...prev, errand]
    );
  }, []);

  const handleAddCustomErrand = useCallback((rawErrand: string) => {
    const clean = rawErrand.trim();
    if (!clean) return;
    setCustomErrands((prev) =>
      prev.some((e) => e.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
    setSelectedErrands((prev) =>
      prev.some((e) => e.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
  }, []);

  const handleRemoveCustomErrand = useCallback((errand: string) => {
    setCustomErrands((prev) => prev.filter((e) => e !== errand));
    setSelectedErrands((prev) => prev.filter((e) => e !== errand));
  }, []);

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

  // Live colony metrics for the global WhatsApp Alert Modal
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

  return {
    ...airQuality,
    activeTab,
    setActiveTab,
    persona,
    setPersona,
    modifiers,
    hacks,
    habits,
    addedRoutinePinIds,
    severeProtocolChecks,
    whatsappLang,
    setWhatsappLang,
    isWhatsappModalOpen,
    setIsWhatsappModalOpen,
    selectedErrands,
    customErrands,
    setRoomAuditSnapshot,
    setCommuteSnapshot,
    pendingMapRoute,
    activeAdvisory,
    isLoadingAdvisory,
    advisoryError,
    toastMessage,
    showToast,
    colonyCo2WeeklyKg,
    carsOffRoad,
    handleRetryAdvisory,
    handleToggleModifier,
    handleToggleRoutine,
    handleToggleHack,
    handleToggleAddVisionFix,
    handleToggleHabit,
    handleChangeHabitDays,
    handleToggleSevereCheck,
    handleToggleErrand,
    handleAddCustomErrand,
    handleRemoveCustomErrand,
    handleOpenMapRoute,
    handleExternalRouteHandled,
    getLiveAppContext,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CityAirProfile,
  CommuteAnalysisResult,
  CommuteLiveSnapshot,
  CommuteMode,
  CommuteTimeSlot,
  ExternalMapRouteRequest,
  HabitSwap,
  LatLngPoint,
} from '../types/aeropulse';
import { calculateHabitSimulatorImpact, sanitizeUserInput } from '../utils/impactCalc';
import { WhatsAppLanguage } from './WhatsAppAlertModal';
import { ColonyRippleCard } from './commute/ColonyRippleCard';
import { ErrandBundlerCard } from './commute/ErrandBundlerCard';
import { HabitRingsCard } from './commute/HabitRingsCard';
import { AnalyzeRouteParams, fetchCommuteAnalysis, RoutePlannerCard } from './commute/RoutePlannerCard';

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
  const [destination, setDestination] = useState(externalRouteRequest?.destination || city.defaultDestination);
  const [originCoords, setOriginCoords] = useState<LatLngPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<LatLngPoint | null>(null);
  const [departureSlot, setDepartureSlot] = useState<CommuteTimeSlot>('8:30-peak');
  const [selectedMode, setSelectedMode] = useState<CommuteMode>('metro');
  const [scale, setScale] = useState<'family' | 'colony'>('family');
  const [analysis, setAnalysis] = useState<CommuteAnalysisResult | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const requestCounterRef = useRef(0);
  const lastCityIdRef = useRef<string | null>(null);
  const lastExternalReqIdRef = useRef<number | null>(null);

  const analyzeRoute = useCallback(async (params: AnalyzeRouteParams) => {
    if (!sanitizeUserInput(params.originText, 120) || !sanitizeUserInput(params.destinationText, 120)) return;
    const reqId = ++requestCounterRef.current;
    setIsLoadingRoute(true);
    setRouteError(null);

    const { data, error } = await fetchCommuteAnalysis(params);
    if (reqId !== requestCounterRef.current) return;
    if (error) setRouteError(error);
    else if (data) setAnalysis(data);
    setIsLoadingRoute(false);
  }, []);

  useEffect(() => {
    if (externalRouteRequest && externalRouteRequest.requestId !== lastExternalReqIdRef.current) {
      lastExternalReqIdRef.current = externalRouteRequest.requestId;
      lastCityIdRef.current = city.id;
      setOrigin(externalRouteRequest.origin);
      setDestination(externalRouteRequest.destination);
      setOriginCoords(null);
      setDestinationCoords(null);
      void analyzeRoute({
        originText: externalRouteRequest.origin,
        destinationText: externalRouteRequest.destination,
        slot: departureSlot,
        mode: selectedMode,
        activeCity: city,
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
      void analyzeRoute({
        originText: city.defaultOrigin,
        destinationText: city.defaultDestination,
        slot: departureSlot,
        mode: selectedMode,
        activeCity: city,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id, externalRouteRequest?.requestId]);

  useEffect(() => {
    const isLowEmission = selectedMode === 'metro' || selectedMode === 'carpool';
    onSnapshotChange?.({
      origin,
      destination,
      departureSlot,
      selectedMode,
      distanceKm: analysis ? (isLowEmission ? analysis.recommended.distanceKm : analysis.highRisk.distanceKm) : null,
      durationMins: analysis ? (isLowEmission ? analysis.recommended.durationMins : analysis.highRisk.durationMins) : null,
      recommendedTitle: analysis?.recommended.title ?? null,
      exposureAqi: analysis ? (isLowEmission ? analysis.recommended.exposureAqi : analysis.highRisk.exposureAqi) : null,
      co2SavedKg: analysis?.recommended.co2SavedKg ?? null,
    });
  }, [origin, destination, departureSlot, selectedMode, analysis, onSnapshotChange]);

  const habitMetrics = useMemo(() => calculateHabitSimulatorImpact(habits, scale), [habits, scale]);

  const runCurrentRoute = (overrides?: Partial<AnalyzeRouteParams>) => {
    void analyzeRoute({
      originText: overrides?.originText ?? origin,
      destinationText: overrides?.destinationText ?? destination,
      slot: overrides?.slot ?? departureSlot,
      mode: overrides?.mode ?? selectedMode,
      activeCity: city,
      resolvedOriginCoords: overrides && 'resolvedOriginCoords' in overrides ? overrides.resolvedOriginCoords : originCoords,
      resolvedDestCoords: overrides && 'resolvedDestCoords' in overrides ? overrides.resolvedDestCoords : destinationCoords,
    });
  };

  return (
    <div className="space-y-6 pb-32">
      <RoutePlannerCard
        city={city}
        origin={origin}
        destination={destination}
        departureSlot={departureSlot}
        selectedMode={selectedMode}
        analysis={analysis}
        isLoadingRoute={isLoadingRoute}
        routeError={routeError}
        onOriginChange={(val) => { setOrigin(val); setOriginCoords(null); }}
        onDestinationChange={(val) => { setDestination(val); setDestinationCoords(null); }}
        onSelectOriginSuggestion={(label, coords) => {
          setOrigin(label);
          setOriginCoords(coords);
          if (destination.trim()) runCurrentRoute({ originText: label, resolvedOriginCoords: coords });
        }}
        onSelectDestinationSuggestion={(label, coords) => {
          setDestination(label);
          setDestinationCoords(coords);
          if (origin.trim()) runCurrentRoute({ destinationText: label, resolvedDestCoords: coords });
        }}
        onSubmitRoute={() => runCurrentRoute()}
        onSwapRoute={() => {
          setOrigin(destination);
          setDestination(origin);
          setOriginCoords(destinationCoords);
          setDestinationCoords(originCoords);
          runCurrentRoute({ originText: destination, destinationText: origin, resolvedOriginCoords: destinationCoords, resolvedDestCoords: originCoords });
        }}
        onRetryRoute={() => runCurrentRoute()}
        onSelectSlot={(slot) => { setDepartureSlot(slot); runCurrentRoute({ slot }); }}
        onSelectMode={(mode) => { setSelectedMode(mode); runCurrentRoute({ mode }); }}
        errandSlot={
          <ErrandBundlerCard
            safeWindowLabel={city.safeWindowLabel}
            selectedErrands={selectedErrands}
            customErrands={customErrands}
            onToggleErrand={onToggleErrand}
            onAddCustomErrand={onAddCustomErrand}
            onRemoveCustomErrand={onRemoveCustomErrand}
          />
        }
      />
      <HabitRingsCard
        habits={habits}
        scale={scale}
        habitMetrics={habitMetrics}
        onChangeScale={setScale}
        onToggleHabit={onToggleHabit}
        onChangeHabitDays={onChangeHabitDays}
        colonyRippleSlot={
          <ColonyRippleCard
            city={city}
            colonyCo2WeeklyKg={habitMetrics.colonyCo2WeeklyKg}
            carsOffRoad={habitMetrics.carsOffRoad}
            whatsappLang={whatsappLang}
            onChangeWhatsappLang={onChangeWhatsappLang}
            onOpenWhatsappModal={onOpenWhatsappModal}
            onShowToast={onShowToast}
          />
        }
      />
    </div>
  );
}

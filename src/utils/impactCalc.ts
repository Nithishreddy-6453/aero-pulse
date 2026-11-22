import { CommuteMode, CommuteTimeSlot, HabitSwap, SeverityLevel } from '../types/aeropulse';

export interface AqiClassification {
  severity: SeverityLevel;
  severityLabel: 'GOOD' | 'MODERATE' | 'POOR' | 'SEVERE';
  isSevereEmergency: boolean;
}

/**
 * Classifies a US AQI value into AeroPulse severity bands and checks the AQI >= 300 emergency threshold.
 */
export function classifyAqiSeverity(aqi: number): AqiClassification {
  const normalized = Number.isFinite(aqi) ? Math.max(0, Math.round(aqi)) : 0;
  if (normalized <= 50) {
    return { severity: 'good', severityLabel: 'GOOD', isSevereEmergency: false };
  }
  if (normalized <= 100) {
    return { severity: 'moderate', severityLabel: 'MODERATE', isSevereEmergency: false };
  }
  if (normalized <= 200) {
    return { severity: 'poor', severityLabel: 'POOR', isSevereEmergency: false };
  }
  return {
    severity: 'severe',
    severityLabel: 'SEVERE',
    isSevereEmergency: normalized >= 300,
  };
}

/**
 * Determines whether the auto-triggered Severe Smog Emergency Banner must activate (strictly AQI >= 300).
 */
export function isSevereSmogEmergency(aqi: number, isLive = true): boolean {
  return isLive && Number.isFinite(aqi) && aqi >= 300;
}

export interface CleanWindowResult {
  startIdx: number;
  endIdx: number;
  label: string;
  averageAqi: number;
}

function formatHourShort(hour24: number): string {
  const normalized = ((hour24 % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const h12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${h12} ${suffix}`;
}

/**
 * Computes the lowest-AQI consecutive 2-hour Safe Outdoor Window from hourly AQI readings.
 * By default assumes index 0 corresponds to 6 AM (6 AM – 11 PM, 18 hourly readings).
 */
export function findBestCleanWindow(
  hourlyAqi: number[],
  startHour24 = 6
): CleanWindowResult {
  if (!Array.isArray(hourlyAqi) || hourlyAqi.length === 0) {
    return {
      startIdx: 0,
      endIdx: 0,
      label: '2 PM – 4 PM',
      averageAqi: 0,
    };
  }

  if (hourlyAqi.length === 1) {
    const val = Math.max(0, Math.round(hourlyAqi[0]));
    return {
      startIdx: 0,
      endIdx: 0,
      label: `${formatHourShort(startHour24)} – ${formatHourShort(startHour24 + 1)}`,
      averageAqi: val,
    };
  }

  let bestStartIdx = 0;
  let bestPairAvg = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hourlyAqi.length - 1; i++) {
    const pairAvg = (hourlyAqi[i] + hourlyAqi[i + 1]) / 2;
    if (pairAvg < bestPairAvg) {
      bestPairAvg = pairAvg;
      bestStartIdx = i;
    }
  }

  const endIdx = bestStartIdx + 1;
  const startLabel = formatHourShort(startHour24 + bestStartIdx);
  const endLabel = formatHourShort(startHour24 + bestStartIdx + 2);

  return {
    startIdx: bestStartIdx,
    endIdx,
    label: `${startLabel} – ${endLabel}`,
    averageAqi: Math.round(bestPairAvg),
  };
}

export interface CommuteImpactInput {
  distanceKm: number;
  cityAqi: number;
  departureSlot: CommuteTimeSlot;
  selectedMode: CommuteMode;
}

export interface CommuteImpactMetrics {
  slotAqi: number;
  recommendedExposureAqi: number;
  highRiskExposureAqi: number;
  exposureReductionPct: number;
  soloCarCo2Kg: number;
  recommendedCo2Kg: number;
  co2SavedKg: number;
  highRiskCo2Kg: number;
}

const CAR_CO2_PER_KM = 0.192;
const TWO_WHEELER_CO2_PER_KM = 0.072;
const CARPOOL_CO2_PER_KM = 0.064;
const TRANSIT_CO2_PER_KM = 0.032;

/**
 * Calculates real-km commute CO₂ savings and inhaled AQI exposure comparison across Indian travel modes.
 */
export function calculateCommuteImpact(input: CommuteImpactInput): CommuteImpactMetrics {
  const distanceKm = Math.max(0.2, Number(input.distanceKm) || 0);
  const baseAqi = Math.max(1, Math.round(Number(input.cityAqi) || 0));

  const slotFactor =
    input.departureSlot === '2:00-safe'
      ? 0.52
      : input.departureSlot === '10:30-mid'
        ? 0.82
        : 1.05;
  const slotAqi = Math.max(1, Math.round(baseAqi * slotFactor));

  const useCarpool = input.selectedMode === 'carpool';
  const useTwoWheeler = input.selectedMode === 'two-wheeler';

  const soloCarCo2Kg = Number((distanceKm * CAR_CO2_PER_KM).toFixed(2));
  const twoWheelerCo2Kg = Number((distanceKm * TWO_WHEELER_CO2_PER_KM).toFixed(2));
  const recommendedCo2Kg = Number(
    (distanceKm * (useCarpool ? CARPOOL_CO2_PER_KM : TRANSIT_CO2_PER_KM)).toFixed(2)
  );
  const co2SavedKg = Number(Math.max(0, soloCarCo2Kg - recommendedCo2Kg).toFixed(1));
  const highRiskCo2Kg = Number((useTwoWheeler ? twoWheelerCo2Kg : soloCarCo2Kg).toFixed(1));

  const recommendedExposureAqi = Math.max(
    18,
    Math.round(slotAqi * (useCarpool ? 0.48 : 0.34))
  );
  const highRiskExposureAqi = Math.max(
    recommendedExposureAqi,
    Math.round(slotAqi * (useTwoWheeler ? 1.18 : 1.0))
  );

  const exposureReductionPct =
    highRiskExposureAqi > 0
      ? Math.max(
          0,
          Math.round(((highRiskExposureAqi - recommendedExposureAqi) / highRiskExposureAqi) * 100)
        )
      : 0;

  return {
    slotAqi,
    recommendedExposureAqi,
    highRiskExposureAqi,
    exposureReductionPct,
    soloCarCo2Kg,
    recommendedCo2Kg,
    co2SavedKg,
    highRiskCo2Kg,
  };
}

export interface HabitSimulatorResult {
  activeCount: number;
  lungShieldPct: number;
  familyCleanHoursWk: number;
  familyCo2KgWk: number;
  displayCleanHours: number;
  displayCo2Kg: number;
  colonyCo2WeeklyKg: number;
  carsOffRoad: number;
  lungRingProgress: number;
  cleanHoursProgress: number;
  co2Progress: number;
}

export const COLONY_HOMES_MULTIPLIER = 500;

/**
 * Computes Choice-to-Impact habit simulator ring metrics and 500-home Colony Ripple impact.
 */
export function calculateHabitSimulatorImpact(
  habits: HabitSwap[],
  scale: 'family' | 'colony' = 'family'
): HabitSimulatorResult {
  const activeHabits = habits.filter((h) => h.enabled);

  const lungShieldPct = Math.min(
    100,
    Math.round(
      activeHabits.reduce((sum, h) => sum + (h.lungWeight * h.daysPerWeek) / 5, 0)
    )
  );

  const familyCleanHoursWk = Number(
    activeHabits
      .reduce((sum, h) => sum + h.cleanHoursPerDay * h.daysPerWeek, 0)
      .toFixed(1)
  );

  const familyCo2KgWk = Number(
    activeHabits
      .reduce((sum, h) => sum + h.co2KgPerDay * h.daysPerWeek, 0)
      .toFixed(1)
  );

  const multiplier = scale === 'colony' ? COLONY_HOMES_MULTIPLIER : 1;
  const displayCleanHours = Math.round(familyCleanHoursWk * multiplier);
  const displayCo2Kg = Number(
    (familyCo2KgWk * multiplier).toFixed(scale === 'colony' ? 0 : 1)
  );

  const colonyCo2WeeklyKg = Math.round(familyCo2KgWk * COLONY_HOMES_MULTIPLIER);
  const colonyCo2MonthlyKg = familyCo2KgWk * COLONY_HOMES_MULTIPLIER * 4;
  const carsOffRoad =
    activeHabits.length === 0 ? 0 : Math.max(12, Math.round(colonyCo2MonthlyKg / 185));

  return {
    activeCount: activeHabits.length,
    lungShieldPct,
    familyCleanHoursWk,
    familyCo2KgWk,
    displayCleanHours,
    displayCo2Kg,
    colonyCo2WeeklyKg,
    carsOffRoad,
    lungRingProgress: Math.max(0.08, Math.min(1, lungShieldPct / 100)),
    cleanHoursProgress: Math.max(0.08, Math.min(1, familyCleanHoursWk / 30)),
    co2Progress: Math.max(0.08, Math.min(1, familyCo2KgWk / 24)),
  };
}

export interface ErrandBundleResult {
  stopCount: number;
  isBundled: boolean;
  coldStartsAvoided: number;
  co2SavedKg: number;
  roadsidePm25ReductionPct: number;
}

/**
 * Calculates avoided cold-start trips, CO₂ savings, and roadside PM2.5 reduction when bundling 2+ errands.
 */
export function calculateErrandBundleImpact(selectedErrands: string[]): ErrandBundleResult {
  const uniqueStops = Array.from(
    new Set(selectedErrands.map((s) => s.trim()).filter((s) => s.length > 0))
  );
  const stopCount = uniqueStops.length;
  if (stopCount < 2) {
    return {
      stopCount,
      isBundled: false,
      coldStartsAvoided: 0,
      co2SavedKg: 0,
      roadsidePm25ReductionPct: 0,
    };
  }

  const coldStartsAvoided = stopCount - 1;
  const co2SavedKg = Number((coldStartsAvoided * 0.7).toFixed(1));
  const roadsidePm25ReductionPct = Math.min(48, 16 + coldStartsAvoided * 12);

  return {
    stopCount,
    isBundled: true,
    coldStartsAvoided,
    co2SavedKg,
    roadsidePm25ReductionPct,
  };
}

/**
 * Sanitizes user text inputs before rendering or sending to backend APIs (strips angle brackets,
 * control characters, collapses whitespace, and caps length).
 */
export function sanitizeUserInput(raw: string, maxLength = 240): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

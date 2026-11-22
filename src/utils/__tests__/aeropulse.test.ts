import { describe, expect, it } from 'vitest';
import { INITIAL_HABIT_SWAPS } from '../../data/mockCities';
import {
  calculateCommuteImpact,
  calculateErrandBundleImpact,
  calculateHabitSimulatorImpact,
  classifyAqiSeverity,
  findBestCleanWindow,
  isSevereSmogEmergency,
  sanitizeUserInput,
} from '../impactCalc';

describe('AeroPulse Core Calculations & Safety Rules', () => {
  describe('1. AQI Severity Classification & Severe Smog Emergency Trigger', () => {
    it('classifies Good (0–50), Moderate (51–100), Poor (101–200), and Severe (201+) accurately', () => {
      expect(classifyAqiSeverity(38)).toEqual({
        severity: 'good',
        severityLabel: 'GOOD',
        isSevereEmergency: false,
      });
      expect(classifyAqiSeverity(86)).toEqual({
        severity: 'moderate',
        severityLabel: 'MODERATE',
        isSevereEmergency: false,
      });
      expect(classifyAqiSeverity(164)).toEqual({
        severity: 'poor',
        severityLabel: 'POOR',
        isSevereEmergency: false,
      });
      expect(classifyAqiSeverity(265)).toEqual({
        severity: 'severe',
        severityLabel: 'SEVERE',
        isSevereEmergency: false,
      });
      expect(classifyAqiSeverity(342)).toEqual({
        severity: 'severe',
        severityLabel: 'SEVERE',
        isSevereEmergency: true,
      });
    });

    it('triggers the Severe Smog Emergency Banner strictly when live AQI >= 300', () => {
      expect(isSevereSmogEmergency(299, true)).toBe(false);
      expect(isSevereSmogEmergency(300, true)).toBe(true);
      expect(isSevereSmogEmergency(412, true)).toBe(true);
      expect(isSevereSmogEmergency(350, false)).toBe(false);
    });
  });

  describe('2. 24-Hour Clean Window Calculation from Hourly AQI', () => {
    it('identifies the exact lowest-AQI consecutive 2-hour window starting at 6 AM', () => {
      // Hours 6 AM (idx 0) through 11 PM (idx 17)
      // Lowest consecutive pair is idx 8 (2 PM: 92) and idx 9 (3 PM: 88) => "2 PM – 4 PM"
      const hourlyAqi = [
        290, 310, 295, 250, 210, 175, 145, 118, 92, 88, 108, 138, 182, 224, 260, 288, 302, 315,
      ];
      const windowResult = findBestCleanWindow(hourlyAqi, 6);
      expect(windowResult.startIdx).toBe(8);
      expect(windowResult.endIdx).toBe(9);
      expect(windowResult.label).toBe('2 PM – 4 PM');
      expect(windowResult.averageAqi).toBe(90);
    });

    it('handles morning clean windows accurately when coastal sea breeze peaks early', () => {
      const hourlyAqi = [48, 52, 65, 80, 95, 110, 120];
      const windowResult = findBestCleanWindow(hourlyAqi, 6);
      expect(windowResult.startIdx).toBe(0);
      expect(windowResult.endIdx).toBe(1);
      expect(windowResult.label).toBe('6 AM – 8 AM');
      expect(windowResult.averageAqi).toBe(50);
    });
  });

  describe('3. Commute CO₂ & PM2.5 Exposure Savings Math', () => {
    it('calculates real-km CO₂ savings and cabin AQI reduction for Metro vs Solo Car', () => {
      const result = calculateCommuteImpact({
        distanceKm: 15,
        cityAqi: 300,
        departureSlot: '8:30-peak',
        selectedMode: 'metro',
      });
      // Solo car: 15 * 0.192 = 2.88 kg; Transit: 15 * 0.032 = 0.48 kg; Saved = 2.4 kg
      expect(result.soloCarCo2Kg).toBe(2.88);
      expect(result.recommendedCo2Kg).toBe(0.48);
      expect(result.co2SavedKg).toBe(2.4);
      // Peak slot AQI = 300 * 1.05 = 315; Metro cabin = 315 * 0.34 = 107
      expect(result.slotAqi).toBe(315);
      expect(result.recommendedExposureAqi).toBe(107);
      expect(result.highRiskExposureAqi).toBe(315);
      expect(result.exposureReductionPct).toBe(66);
    });

    it('penalizes open 2-wheeler roadside exposure relative to AC carpool during safe window', () => {
      const twoWheeler = calculateCommuteImpact({
        distanceKm: 10,
        cityAqi: 200,
        departureSlot: '2:00-safe',
        selectedMode: 'two-wheeler',
      });
      // Safe slot AQI = 200 * 0.52 = 104; 2-wheeler = 104 * 1.18 = 123
      expect(twoWheeler.slotAqi).toBe(104);
      expect(twoWheeler.highRiskExposureAqi).toBe(123);
      expect(twoWheeler.recommendedExposureAqi).toBeLessThan(twoWheeler.highRiskExposureAqi);
      expect(twoWheeler.co2SavedKg).toBeGreaterThan(1.5);
    });
  });

  describe('4. Choice-to-Impact Habit Simulator & Colony 500x Multiplier', () => {
    it('computes accurate family weekly totals and scales cleanly to 500 homes in colony', () => {
      const family = calculateHabitSimulatorImpact(INITIAL_HABIT_SWAPS, 'family');
      const colony = calculateHabitSimulatorImpact(INITIAL_HABIT_SWAPS, 'colony');

      expect(family.activeCount).toBe(3);
      expect(family.lungShieldPct).toBeGreaterThan(50);
      expect(family.familyCo2KgWk).toBeGreaterThan(10);
      expect(colony.displayCo2Kg).toBe(Math.round(family.familyCo2KgWk * 500));
      expect(colony.displayCleanHours).toBe(Math.round(family.familyCleanHoursWk * 500));
      expect(colony.carsOffRoad).toBeGreaterThanOrEqual(12);
    });

    it('returns zero impact when all habits are disabled', () => {
      const disabled = INITIAL_HABIT_SWAPS.map((h) => ({ ...h, enabled: false }));
      const result = calculateHabitSimulatorImpact(disabled, 'colony');
      expect(result.activeCount).toBe(0);
      expect(result.lungShieldPct).toBe(0);
      expect(result.familyCo2KgWk).toBe(0);
      expect(result.colonyCo2WeeklyKg).toBe(0);
      expect(result.carsOffRoad).toBe(0);
    });
  });

  describe('5. Errand Bundler Trip-Reduction Math', () => {
    it('requires at least 2 stops before claiming trip reduction savings', () => {
      expect(calculateErrandBundleImpact([]).isBundled).toBe(false);
      expect(calculateErrandBundleImpact(['Groceries'])).toEqual({
        stopCount: 1,
        isBundled: false,
        coldStartsAvoided: 0,
        co2SavedKg: 0,
        roadsidePm25ReductionPct: 0,
      });
    });

    it('scales avoided cold-start trips, CO₂ savings, and roadside PM2.5 drop for 2–4+ stops', () => {
      const threeStops = calculateErrandBundleImpact(['Groceries', 'Pharmacy', 'School Pickup']);
      expect(threeStops).toEqual({
        stopCount: 3,
        isBundled: true,
        coldStartsAvoided: 2,
        co2SavedKg: 1.4,
        roadsidePm25ReductionPct: 40,
      });

      const fiveStops = calculateErrandBundleImpact([
        'Groceries',
        'Pharmacy',
        'School Pickup',
        'Gym / Bank',
        'Dry Cleaner',
      ]);
      expect(fiveStops.coldStartsAvoided).toBe(4);
      expect(fiveStops.co2SavedKg).toBe(2.8);
      // Capped safely at 48%
      expect(fiveStops.roadsidePm25ReductionPct).toBe(48);
    });
  });

  describe('6. Security Input Sanitization', () => {
    it('strips HTML tags, control characters, and enforces max length on user inputs', () => {
      const dirty = '  <script>alert(1)</script>New Delhi\u0007   Sector 4  ';
      expect(sanitizeUserInput(dirty, 50)).toBe('alert(1)New Delhi Sector 4');
      expect(sanitizeUserInput('a'.repeat(300), 100).length).toBe(100);
    });
  });
});

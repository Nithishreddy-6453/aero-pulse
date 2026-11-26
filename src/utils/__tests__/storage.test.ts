// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HABIT_SWAPS, INITIAL_INDOOR_HACKS } from '../../data/indianCities';
import {
  hydrateHabits,
  hydrateHacks,
  loadPersistedState,
  PersistedAeroPulseState,
  savePersistedState,
} from '../storage';

const STORAGE_KEY = 'aeropulse_user_state_v1';

describe('AeroPulse LocalStorage Persistence (storage.ts)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('saves and loads persisted city, persona, habits, and room-audit fixes accurately', () => {
    const firstHackId = INITIAL_INDOOR_HACKS[0].id;
    const state: PersistedAeroPulseState = {
      selectedCityId: 'mumbai',
      customCity: {
        id: 'custom-pune',
        name: 'Pune',
        state: 'Maharashtra',
        lat: 18.5204,
        lng: 73.8567,
        colonyName: 'Kothrud RWA',
      },
      persona: 'senior',
      modifiers: ['asthma'],
      completedRoutineMap: { 'mumbai|senior': ['r1'] },
      hackCompletedMap: { [firstHackId]: true },
      roomAuditHacks: [
        {
          id: 'audit-door-seal',
          title: 'Door Draft Excluder Strip',
          budget: 'diy',
          priceLabel: '₹350',
          impactPill: '-25% outdoor PM2.5',
          whyText: 'Blocks corridor dust infiltration.',
          completed: false,
          source: 'room-audit',
        },
      ],
      addedRoutinePinIds: ['audit-door-seal'],
      habitStates: [
        { id: INITIAL_HABIT_SWAPS[0].id, enabled: false, daysPerWeek: 4 },
      ],
      severeProtocolChecks: ['close-windows'],
      whatsappLang: 'hi',
      bundledErrands: ['Groceries', 'Pharmacy'],
      customErrands: ['Dry Cleaner'],
    };

    savePersistedState(state);
    const loaded = loadPersistedState();

    expect(loaded).not.toBeNull();
    expect(loaded?.selectedCityId).toBe('mumbai');
    expect(loaded?.customCity?.name).toBe('Pune');
    expect(loaded?.persona).toBe('senior');
    expect(loaded?.modifiers).toEqual(['asthma']);
    expect(loaded?.habitStates).toEqual([
      { id: INITIAL_HABIT_SWAPS[0].id, enabled: false, daysPerWeek: 4 },
    ]);
    expect(loaded?.roomAuditHacks).toHaveLength(1);
    expect(loaded?.roomAuditHacks?.[0].id).toBe('audit-door-seal');

    const hydratedHabits = hydrateHabits(INITIAL_HABIT_SWAPS, loaded);
    expect(hydratedHabits[0].enabled).toBe(false);
    expect(hydratedHabits[0].daysPerWeek).toBe(4);

    const hydratedHacks = hydrateHacks(INITIAL_INDOOR_HACKS, loaded);
    expect(hydratedHacks[0].id).toBe('audit-door-seal');
    expect(hydratedHacks[0].source).toBe('room-audit');
    expect(hydratedHacks.find((h) => h.id === firstHackId)?.completed).toBe(true);
  });

  it('falls back gracefully to null when localStorage contains corrupted JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{corrupted-json:::[invalid');
    expect(() => loadPersistedState()).not.toThrow();
    expect(loadPersistedState()).toBeNull();
  });

  it('ignores invalid persisted persona/habit fields and keeps valid data', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedCityId: 'delhi',
        persona: 'invalid-persona',
        habitStates: [
          { id: 'bad', enabled: true, daysPerWeek: 99 },
          { id: 'good', enabled: true, daysPerWeek: 3 },
        ],
        roomAuditHacks: [{ id: 123, missingFields: true }],
      })
    );

    const loaded = loadPersistedState();
    expect(loaded?.selectedCityId).toBe('delhi');
    expect(loaded?.persona).toBeUndefined();
    expect(loaded?.habitStates).toEqual([{ id: 'good', enabled: true, daysPerWeek: 3 }]);
    expect(loaded?.roomAuditHacks).toEqual([]);
  });

  it('handles localStorage quota exceeded and access SecurityError without crashing', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('SecurityError', 'SecurityError');
      });

    const state: PersistedAeroPulseState = {
      selectedCityId: 'bengaluru',
      persona: 'commuter',
      modifiers: [],
      completedRoutineMap: {},
      hackCompletedMap: {},
      roomAuditHacks: [],
      addedRoutinePinIds: [],
      habitStates: [],
      severeProtocolChecks: [],
      whatsappLang: 'en',
      bundledErrands: [],
      customErrands: [],
    };

    expect(() => savePersistedState(state)).not.toThrow();
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    let loaded: ReturnType<typeof loadPersistedState> = undefined as never;
    expect(() => {
      loaded = loadPersistedState();
    }).not.toThrow();
    expect(loaded).toBeNull();
    expect(getItemSpy).toHaveBeenCalledTimes(1);
  });
});

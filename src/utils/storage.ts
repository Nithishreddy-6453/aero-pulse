import {
  CityAirProfile,
  HabitSwap,
  IndoorHack,
  PersonaId,
  QuickModifier,
} from '../types/aeropulse';

const STORAGE_KEY = 'aeropulse_user_state_v1';

export interface PersistedCustomCity {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  defaultOrigin?: string;
  defaultDestination?: string;
  colonyName?: string;
}

export interface PersistedHabitState {
  id: string;
  enabled: boolean;
  daysPerWeek: number;
}

export interface PersistedAeroPulseState {
  selectedCityId: string;
  customCity?: PersistedCustomCity | null;
  persona: PersonaId;
  modifiers: QuickModifier[];
  completedRoutineMap: Record<string, string[]>;
  hackCompletedMap: Record<string, boolean>;
  roomAuditHacks: IndoorHack[];
  addedRoutinePinIds: string[];
  habitStates: PersistedHabitState[];
  severeProtocolChecks: string[];
  whatsappLang: 'en' | 'hi';
  bundledErrands: string[];
  customErrands: string[];
}

const VALID_PERSONAS: PersonaId[] = ['parent', 'senior', 'commuter', 'student'];
const VALID_MODIFIERS: QuickModifier[] = ['asthma', 'gasStove'];

export function loadPersistedState(): Partial<PersistedAeroPulseState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const result: Partial<PersistedAeroPulseState> = {};

    if (typeof parsed.selectedCityId === 'string' && parsed.selectedCityId.trim()) {
      result.selectedCityId = parsed.selectedCityId.trim();
    }

    if (parsed.customCity && typeof parsed.customCity === 'object') {
      const c = parsed.customCity as Record<string, unknown>;
      if (
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        typeof c.lat === 'number' &&
        typeof c.lng === 'number' &&
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng)
      ) {
        result.customCity = {
          id: c.id,
          name: c.name,
          state: typeof c.state === 'string' ? c.state : 'India',
          lat: c.lat,
          lng: c.lng,
          defaultOrigin: typeof c.defaultOrigin === 'string' ? c.defaultOrigin : undefined,
          defaultDestination:
            typeof c.defaultDestination === 'string' ? c.defaultDestination : undefined,
          colonyName: typeof c.colonyName === 'string' ? c.colonyName : undefined,
        };
      }
    }

    if (typeof parsed.persona === 'string' && VALID_PERSONAS.includes(parsed.persona as PersonaId)) {
      result.persona = parsed.persona as PersonaId;
    }

    if (Array.isArray(parsed.modifiers)) {
      result.modifiers = parsed.modifiers.filter(
        (m): m is QuickModifier =>
          typeof m === 'string' && VALID_MODIFIERS.includes(m as QuickModifier)
      );
    }

    if (parsed.completedRoutineMap && typeof parsed.completedRoutineMap === 'object') {
      const cleanMap: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed.completedRoutineMap as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          cleanMap[k] = v.filter((id): id is string => typeof id === 'string');
        }
      }
      result.completedRoutineMap = cleanMap;
    }

    if (parsed.hackCompletedMap && typeof parsed.hackCompletedMap === 'object') {
      const cleanHacks: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed.hackCompletedMap as Record<string, unknown>)) {
        if (typeof v === 'boolean') cleanHacks[k] = v;
      }
      result.hackCompletedMap = cleanHacks;
    }

    if (Array.isArray(parsed.roomAuditHacks)) {
      result.roomAuditHacks = parsed.roomAuditHacks.filter((h): h is IndoorHack => {
        if (!h || typeof h !== 'object') return false;
        const item = h as Record<string, unknown>;
        return (
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          (item.budget === 'free' || item.budget === 'diy' || item.budget === 'smart') &&
          typeof item.priceLabel === 'string' &&
          typeof item.impactPill === 'string' &&
          typeof item.whyText === 'string' &&
          typeof item.completed === 'boolean'
        );
      });
    }

    if (Array.isArray(parsed.addedRoutinePinIds)) {
      result.addedRoutinePinIds = parsed.addedRoutinePinIds.filter(
        (id): id is string => typeof id === 'string'
      );
    }

    if (Array.isArray(parsed.habitStates)) {
      result.habitStates = parsed.habitStates.filter((h): h is PersistedHabitState => {
        if (!h || typeof h !== 'object') return false;
        const item = h as Record<string, unknown>;
        return (
          typeof item.id === 'string' &&
          typeof item.enabled === 'boolean' &&
          typeof item.daysPerWeek === 'number' &&
          item.daysPerWeek >= 1 &&
          item.daysPerWeek <= 5
        );
      });
    }

    if (Array.isArray(parsed.severeProtocolChecks)) {
      result.severeProtocolChecks = parsed.severeProtocolChecks.filter(
        (s): s is string => typeof s === 'string'
      );
    }

    if (parsed.whatsappLang === 'en' || parsed.whatsappLang === 'hi') {
      result.whatsappLang = parsed.whatsappLang;
    }

    if (Array.isArray(parsed.bundledErrands)) {
      result.bundledErrands = parsed.bundledErrands.filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      );
    }

    if (Array.isArray(parsed.customErrands)) {
      result.customErrands = parsed.customErrands.filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      );
    }

    return result;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedAeroPulseState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or private-mode restrictions gracefully
  }
}

export function hydrateHacks(
  defaultHacks: IndoorHack[],
  saved: Partial<PersistedAeroPulseState> | null
): IndoorHack[] {
  if (!saved) return defaultHacks;
  const completedMap = saved.hackCompletedMap ?? {};
  const base = defaultHacks.map((h) =>
    typeof completedMap[h.id] === 'boolean' ? { ...h, completed: completedMap[h.id] } : h
  );
  const savedAuditHacks = (saved.roomAuditHacks ?? []).map((h) => ({
    ...h,
    source: 'room-audit' as const,
  }));
  // Avoid duplicate IDs
  const baseIds = new Set(base.map((b) => b.id));
  const uniqueAudit = savedAuditHacks.filter((h) => !baseIds.has(h.id));
  return [...uniqueAudit, ...base];
}

export function hydrateHabits(
  defaultHabits: HabitSwap[],
  saved: Partial<PersistedAeroPulseState> | null
): HabitSwap[] {
  if (!saved?.habitStates || saved.habitStates.length === 0) return defaultHabits;
  const map = new Map(saved.habitStates.map((h) => [h.id, h]));
  return defaultHabits.map((habit) => {
    const match = map.get(habit.id);
    if (!match) return habit;
    return {
      ...habit,
      enabled: match.enabled,
      daysPerWeek: match.daysPerWeek,
    };
  });
}

export function extractCustomCityMetadata(
  selectedCity: CityAirProfile,
  presetIds: Set<string>
): PersistedCustomCity | null {
  if (presetIds.has(selectedCity.id)) return null;
  return {
    id: selectedCity.id,
    name: selectedCity.name,
    state: selectedCity.state,
    lat: selectedCity.center.lat,
    lng: selectedCity.center.lng,
    defaultOrigin: selectedCity.defaultOrigin,
    defaultDestination: selectedCity.defaultDestination,
    colonyName: selectedCity.colonyName,
  };
}

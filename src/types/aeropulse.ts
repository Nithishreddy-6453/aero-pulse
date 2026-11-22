export type AeroTab = 'today' | 'room-audit' | 'commute';

export type SeverityLevel = 'severe' | 'poor' | 'moderate' | 'good';

export type PersonaId = 'parent' | 'senior' | 'commuter' | 'student';

export type QuickModifier = 'asthma' | 'gasStove';

export type BudgetTier = 'all' | 'free' | 'diy' | 'smart';

export type RoomCategory = 'living' | 'kitchen' | 'kids' | 'balcony';

export type RoomRiskFlag = 'gasStove' | 'mainRoad' | 'noPurifier';

export type RoomPresetId = 'balcony-door' | 'gas-kitchen' | 'kids-study';

export type CommuteTimeSlot = '8:30-peak' | '10:30-mid' | '2:00-safe';

export type CommuteMode = 'metro' | 'carpool' | 'car' | 'two-wheeler';

export interface HourlyWindowSlot {
  hourLabel: string;
  shortLabel: string;
  aqi: number;
  pm25: number;
  status: 'peak' | 'moderate' | 'safe';
}

export interface CityHotspot {
  id: string;
  name: string;
  zoneType: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  aqi: number;
  pm25: number;
  no2: number;
  radius: number; // visual thermal plume radius
  note: string;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface CityAirProfile {
  id: string;
  name: string;
  state: string;
  center: LatLngPoint;
  aqi: number;
  severity: SeverityLevel;
  severityLabel: string;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  indoorCo2: number;
  safeWindowLabel: string;
  safeStartIdx: number;
  safeEndIdx: number;
  defaultOrigin: string;
  defaultDestination: string;
  colonyName: string;
  hourlyTimeline: HourlyWindowSlot[];
  hotspots: CityHotspot[];
  isLive: boolean;
  fetchedAtIso?: string;
  fetchedAtLabel?: string;
}

export interface LiveAirQualityResponse {
  aqi: number;
  severity: SeverityLevel;
  severityLabel: string;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  indoorCo2Estimate: number;
  safeWindowLabel: string;
  safeStartIdx: number;
  safeEndIdx: number;
  hourlyTimeline: HourlyWindowSlot[];
  fetchedAtIso: string;
  fetchedAtLabel: string;
  sourceLabel: string;
}

export interface IndianCitySearchResult {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
}

export interface TodayAdvisoryRoutineItem {
  id: string;
  period: 'Morning' | 'Afternoon' | 'Evening';
  title: string;
  impactPill: string;
  whyPill: string;
  completed: boolean;
}

export interface TodayAdvisoryPayload {
  heroVerdict: string;
  asthmaTip: string;
  gasStoveTip: string;
  routines: TodayAdvisoryRoutineItem[];
  modelUsed?: string;
}

export interface CopilotAskResponse {
  headline: string;
  answer: string;
  impactTag: string;
  modelUsed?: string;
}

export interface RoomAuditLiveSnapshot {
  roomLabel: string;
  riskFlags: RoomRiskFlag[];
  diagnosis: RoomVisionDiagnosis | null;
}

export interface CommuteLiveSnapshot {
  origin: string;
  destination: string;
  departureSlot: CommuteTimeSlot;
  selectedMode: CommuteMode;
  distanceKm: number | null;
  durationMins: number | null;
  recommendedTitle: string | null;
  exposureAqi: number | null;
  co2SavedKg: number | null;
}

export interface LiveAppContext {
  activeTab: 'Today' | 'Room Audit' | 'Commute & Impact';
  telemetry: {
    city: string;
    state: string;
    aqi: number;
    severityLabel: string;
    pm25: number;
    pm10: number;
    no2: number;
    o3: number;
    safeWindowLabel: string;
    hourlySummary: string;
    isLive: boolean;
  };
  profile: {
    personaId: PersonaId;
    personaLabel: string;
    riskChips: string[];
  };
  roomAudit: {
    roomLabel: string;
    riskLevel: VisionRiskLevel;
    fixPotentialPercent: number;
    traps: Array<{
      id: number;
      title: string;
      category: VisionTrapCategory;
      costBadge: string;
      fixAction: string;
      whyImpact: string;
    }>;
    addedFixes: string[];
  } | null;
  commute: {
    origin: string;
    destination: string;
    distanceKm: number | null;
    durationMins: number | null;
    selectedMode: CommuteMode;
    departureSlot: CommuteTimeSlot;
    recommendedTitle: string | null;
    exposureAqi: number | null;
    co2SavedKg: number | null;
  } | null;
  activeHabits: Array<{
    title: string;
    daysPerWeek: number;
    tag: string;
  }>;
}

export interface CopilotMapAction {
  action: 'OPEN_MAP';
  origin: string;
  destination: string;
}

export interface ExternalMapRouteRequest {
  origin: string;
  destination: string;
  requestId: number;
}

export interface CopilotChatReply {
  directAnswer: string;
  steps: string[];
  whyImpact: string;
  mapAction?: CopilotMapAction | null;
  modelUsed?: string;
}

export type CopilotChatItem =
  | {
      id: string;
      kind: 'user';
      text: string;
    }
  | {
      id: string;
      kind: 'assistant';
      directAnswer: string;
      steps: string[];
      whyImpact: string;
      mapAction?: CopilotMapAction | null;
      modelUsed?: string;
    }
  | {
      id: string;
      kind: 'divider';
      label: string;
    };

export interface RouteOptionMetrics {
  available: boolean;
  mode: 'TRANSIT' | 'DRIVE' | 'TWO_WHEELER';
  distanceKm: number;
  durationMins: number;
  coordinates: [number, number][];
  startLocation: LatLngPoint | null;
  endLocation: LatLngPoint | null;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
  transitLines: string[];
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface CommuteGearBadge {
  label: string;
  tone: 'coral' | 'amber' | 'emerald' | 'cyan' | 'neutral';
}

export interface CommuteAnalysisResult {
  originResolved: string;
  destinationResolved: string;
  routes: {
    transit: RouteOptionMetrics;
    drive: RouteOptionMetrics;
    twoWheeler: RouteOptionMetrics;
  };
  recommended: {
    title: string;
    modeUsed: 'transit' | 'carpool';
    durationMins: number;
    distanceKm: number;
    exposureAqi: number;
    exposureLabel: string;
    co2Kg: number;
    co2SavedKg: number;
    transitLines: string[];
    whyLine: string;
  };
  highRisk: {
    title: string;
    modeUsed: 'car' | 'two-wheeler';
    durationMins: number;
    distanceKm: number;
    exposureAqi: number;
    exposureLabel: string;
    co2AddedKg: number;
    whyLine: string;
  };
  gearBadges: CommuteGearBadge[];
  geminiInsight: string | null;
  geminiQuotaLimited?: boolean;
  geminiError?: string | null;
  groundingLinks: GroundingLink[];
}

export interface RoutineItem {
  id: string;
  period: 'Morning' | 'Afternoon' | 'Evening';
  title: string;
  impactPill: string;
  whyPill: string;
  personas: PersonaId[];
  completed: boolean;
  source?: 'default' | 'room-audit';
}

export interface IndoorHack {
  id: string;
  title: string;
  budget: Exclude<BudgetTier, 'all'>;
  priceLabel: string;
  impactPill: string;
  whyText: string;
  completed: boolean;
  highlightForGas?: boolean;
  highlightForAsthma?: boolean;
  source?: 'default' | 'room-audit';
  auditRoomLabel?: string;
}

export interface RoomTrapPin {
  id: number;
  x: number; // percentage
  y: number; // percentage
  trapLabel: string;
  fixTitle: string;
  budget: Exclude<BudgetTier, 'all'>;
  priceLabel: string;
  impactPill: string;
  whyPill: string;
  pmReductionPct: number;
}

export type VisionRiskLevel = 'Low' | 'Moderate' | 'High' | 'Severe';
export type VisionTrapCategory = 'Free' | 'DIY' | 'Smart';

export interface RoomVisionTrap {
  id: number;
  title: string;
  x: number;
  y: number;
  category: VisionTrapCategory;
  costBadge: string;
  fixAction: string;
  whyImpact: string;
}

export interface RoomVisionDiagnosis {
  riskLevel: VisionRiskLevel;
  fixPotentialPercent: number;
  traps: RoomVisionTrap[];
  modelUsed?: string;
}

export interface RoomAuditPreset {
  id: RoomPresetId;
  label: string;
  roomType: RoomCategory;
  imageUrl: string;
  baseRisk: 'High' | 'Moderate' | 'Elevated';
  baseFixPotential: number;
  pins: RoomTrapPin[];
}

export interface HabitSwap {
  id: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  daysPerWeek: number;
  lungWeight: number;
  cleanHoursPerDay: number;
  co2KgPerDay: number;
  tag: string;
}

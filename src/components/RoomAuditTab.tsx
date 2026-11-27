import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Flame,
  Home,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Upload,
  Wind,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ROOM_AUDIT_PRESETS } from '../data/indianCities';
import { analyzeRoomPhotoWithGemini } from '../services/gemini';
import {
  BudgetTier,
  CityAirProfile,
  RoomAuditLiveSnapshot,
  RoomCategory,
  RoomPresetId,
  RoomRiskFlag,
  RoomVisionDiagnosis,
  RoomVisionTrap,
  VisionRiskLevel,
} from '../types/aeropulse';
import { AnimatedNumber } from './AnimatedNumber';
import { CircularToggle } from './CircularToggle';

interface RoomAuditTabProps {
  city: CityAirProfile;
  addedAuditFixKeys: string[];
  onToggleAddVisionFix: (fixKey: string, roomLabel: string, trap: RoomVisionTrap) => void;
  onSnapshotChange?: (snapshot: RoomAuditLiveSnapshot) => void;
}

const ROOM_PILLS: { id: RoomCategory; label: string; presetId: RoomPresetId }[] = [
  { id: 'living', label: 'Living Room', presetId: 'balcony-door' },
  { id: 'kitchen', label: 'Kitchen', presetId: 'gas-kitchen' },
  { id: 'kids', label: "Kids' Bedroom", presetId: 'kids-study' },
  { id: 'balcony', label: 'Balcony', presetId: 'balcony-door' },
];

const RISK_CHIPS: { id: RoomRiskFlag; label: string; contextName: string; icon: typeof Flame }[] = [
  { id: 'gasStove', label: '+ Gas Stove', contextName: 'Gas Stove', icon: Flame },
  { id: 'mainRoad', label: '+ Near Main Road', contextName: 'Near Main Road', icon: ShieldAlert },
  { id: 'noPurifier', label: '+ No Purifier', contextName: 'No Purifier', icon: Wind },
];

const BUDGET_FILTERS: { id: BudgetTier; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free ₹0' },
  { id: 'diy', label: 'DIY < ₹1.5k' },
  { id: 'smart', label: 'Smart' },
];

/**
 * Compresses & resizes any image source (uploaded File or preset URL) on an HTML canvas
 * to max 1024px width at JPEG 0.8 quality before sending to Gemini Vision API.
 */
async function compressImageToJpeg(
  source: File | string,
  maxWidth = 1024,
  quality = 0.8
): Promise<{ base64: string; mimeType: 'image/jpeg'; dataUrl: string }> {
  const objectUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode room image.'));
      el.src = objectUrl;
    });

    const naturalW = img.naturalWidth || img.width || 1024;
    const naturalH = img.naturalHeight || img.height || 768;
    const scale = naturalW > maxWidth ? maxWidth / naturalW : 1;
    const targetW = Math.max(1, Math.round(naturalW * scale));
    const targetH = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) throw new Error('Failed to encode JPEG image.');

    return { base64, mimeType: 'image/jpeg', dataUrl };
  } finally {
    if (typeof source !== 'string') {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function getRiskBadgeStyle(riskLevel: VisionRiskLevel): string {
  switch (riskLevel) {
    case 'Severe':
    case 'High':
      return 'text-[#C81E1E] bg-[#FF3B30]/12 ring-[#FF3B30]/25';
    case 'Moderate':
      return 'text-[#B45309] bg-[#FF9500]/14 ring-[#FF9500]/30';
    default:
      return 'text-[#15803D] bg-[#34C759]/14 ring-[#34C759]/30';
  }
}

interface RoomAuditSlotState {
  presetId: RoomPresetId;
  riskFlags: RoomRiskFlag[];
  uploadedPreviewUrl: string | null;
  uploadedBase64: string | null;
  uploadedLabel: string | null;
  imageError: boolean;
  selectedPinId: number;
  diagnosis: RoomVisionDiagnosis | null;
  isScanning: boolean;
  scanError: string | null;
}

const DEFAULT_ROOM_CONFIG: Record<
  RoomCategory,
  { presetId: RoomPresetId; riskFlags: RoomRiskFlag[] }
> = {
  living: { presetId: 'balcony-door', riskFlags: ['mainRoad'] },
  kitchen: { presetId: 'gas-kitchen', riskFlags: ['gasStove'] },
  kids: { presetId: 'kids-study', riskFlags: ['noPurifier'] },
  balcony: { presetId: 'balcony-door', riskFlags: ['mainRoad'] },
};

function createDefaultRoomSlot(roomId: RoomCategory): RoomAuditSlotState {
  const cfg = DEFAULT_ROOM_CONFIG[roomId];
  return {
    presetId: cfg.presetId,
    riskFlags: [...cfg.riskFlags],
    uploadedPreviewUrl: null,
    uploadedBase64: null,
    uploadedLabel: null,
    imageError: false,
    selectedPinId: 1,
    diagnosis: null,
    isScanning: false,
    scanError: null,
  };
}

function createInitialRoomStates(): Record<RoomCategory, RoomAuditSlotState> {
  return {
    living: createDefaultRoomSlot('living'),
    kitchen: createDefaultRoomSlot('kitchen'),
    kids: createDefaultRoomSlot('kids'),
    balcony: createDefaultRoomSlot('balcony'),
  };
}

function revokeBlobUrl(url: string | null | undefined) {
  if (
    url &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(url);
  }
}

function mapCategoryToBudget(category: RoomVisionTrap['category']): Exclude<BudgetTier, 'all'> {
  if (category === 'Free') return 'free';
  if (category === 'DIY') return 'diy';
  return 'smart';
}

export function RoomAuditTab({
  city,
  addedAuditFixKeys,
  onToggleAddVisionFix,
  onSnapshotChange,
}: RoomAuditTabProps) {
  const [selectedRoom, setSelectedRoom] = useState<RoomCategory>('living');
  const [roomStates, setRoomStates] =
    useState<Record<RoomCategory, RoomAuditSlotState>>(createInitialRoomStates);
  const [glowingCardId, setGlowingCardId] = useState<number | null>(null);
  const [pinPulseCounter, setPinPulseCounter] = useState<Record<number, number>>({});
  const [budgetFilter, setBudgetFilter] = useState<BudgetTier>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Record<number, HTMLElement | null>>({});
  const glowTimerRef = useRef<number | null>(null);
  const roomStatesRef = useRef<Record<RoomCategory, RoomAuditSlotState>>(roomStates);
  roomStatesRef.current = roomStates;

  const scanReqIdsRef = useRef<Record<RoomCategory, number>>({
    living: 0,
    kitchen: 0,
    kids: 0,
    balcony: 0,
  });
  const lastScannedSigRef = useRef<Record<RoomCategory, string | null>>({
    living: null,
    kitchen: null,
    kids: null,
    balcony: null,
  });

  const updateRoomState = useCallback(
    (roomId: RoomCategory, updater: (prev: RoomAuditSlotState) => RoomAuditSlotState) => {
      setRoomStates((prev) => ({
        ...prev,
        [roomId]: updater(prev[roomId]),
      }));
    },
    []
  );

  const activeRoomState = roomStates[selectedRoom];
  const {
    presetId: activePresetId,
    riskFlags,
    selectedPinId,
    uploadedPreviewUrl,
    uploadedBase64,
    uploadedLabel,
    imageError,
    isScanning,
    diagnosis,
    scanError,
  } = activeRoomState;

  const preset =
    ROOM_AUDIT_PRESETS.find((p) => p.id === activePresetId) ?? ROOM_AUDIT_PRESETS[0];

  const activeRoomLabel =
    ROOM_PILLS.find((r) => r.id === selectedRoom)?.label ?? 'Living Room';
  const activeContextLabel = uploadedLabel ? `${activeRoomLabel} (Uploaded)` : preset.label;
  const activePhotoSrc = uploadedPreviewUrl ?? preset.imageUrl;

  const runVisionDiagnosis = useCallback(
    async (opts: {
      roomId: RoomCategory;
      source: File | string;
      precompressedBase64?: string | null;
      roomLabel: string;
      activeRiskFlags: RoomRiskFlag[];
      activeCity: CityAirProfile;
      cacheSignature: string;
      forceRefresh?: boolean;
    }) => {
      const reqId = ++scanReqIdsRef.current[opts.roomId];
      lastScannedSigRef.current[opts.roomId] = opts.cacheSignature;
      updateRoomState(opts.roomId, (prev) => ({
        ...prev,
        isScanning: true,
        scanError: null,
      }));

      try {
        let base64Payload = opts.precompressedBase64 || '';
        if (!base64Payload) {
          const compressed = await compressImageToJpeg(opts.source, 1024, 0.8);
          if (reqId !== scanReqIdsRef.current[opts.roomId]) return;
          base64Payload = compressed.base64;
        }

        const activeRiskNames = opts.activeRiskFlags
          .map((flag) => RISK_CHIPS.find((c) => c.id === flag)?.contextName)
          .filter((name): name is string => Boolean(name));

        const data = await analyzeRoomPhotoWithGemini({
          imageBase64: base64Payload,
          mimeType: 'image/jpeg',
          city: opts.activeCity.name,
          aqi: opts.activeCity.aqi,
          roomType: opts.roomLabel,
          riskChips: activeRiskNames,
          cacheSignature: opts.cacheSignature,
          forceRefresh: opts.forceRefresh,
        });

        if (reqId !== scanReqIdsRef.current[opts.roomId]) return;

        updateRoomState(opts.roomId, (prev) => ({
          ...prev,
          diagnosis: data,
          selectedPinId: data.traps.length > 0 ? data.traps[0].id : prev.selectedPinId,
        }));
      } catch (err) {
        if (reqId === scanReqIdsRef.current[opts.roomId]) {
          updateRoomState(opts.roomId, (prev) => ({
            ...prev,
            scanError:
              err instanceof Error
                ? err.message
                : 'Network error during Gemini Vision room scan.',
          }));
        }
      } finally {
        if (reqId === scanReqIdsRef.current[opts.roomId]) {
          updateRoomState(opts.roomId, (prev) => ({
            ...prev,
            isScanning: false,
          }));
        }
      }
    },
    [updateRoomState]
  );

  // Trigger Gemini Vision automatically when the active room's photo, preset, city, or risk chips change
  const activeSignature = `${selectedRoom}|${city.id}|${Math.round(city.aqi / 10) * 10}|${activeRoomLabel}|${riskFlags.slice().sort().join(',')}|${uploadedLabel ?? preset.id}|${uploadedPreviewUrl ?? ''}`;

  useEffect(() => {
    if (lastScannedSigRef.current[selectedRoom] === activeSignature) return;
    void runVisionDiagnosis({
      roomId: selectedRoom,
      source: uploadedPreviewUrl ?? preset.imageUrl,
      precompressedBase64: uploadedBase64,
      roomLabel: activeRoomLabel,
      activeRiskFlags: riskFlags,
      activeCity: city,
      cacheSignature: activeSignature,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSignature, selectedRoom]);

  // Sync active Room Audit diagnosis & risk flags into global App state for the Copilot
  useEffect(() => {
    onSnapshotChange?.({
      roomLabel: activeContextLabel,
      riskFlags,
      diagnosis,
    });
  }, [activeContextLabel, riskFlags, diagnosis, onSnapshotChange]);

  // Clear glow timer and revoke any active blob object URLs on unmount
  useEffect(() => {
    return () => {
      if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
      Object.values(roomStatesRef.current).forEach((slot) => {
        revokeBlobUrl(slot.uploadedPreviewUrl);
      });
    };
  }, []);

  const handleSelectPreset = (presetId: RoomPresetId, roomCat: RoomCategory) => {
    revokeBlobUrl(roomStatesRef.current[roomCat].uploadedPreviewUrl);
    lastScannedSigRef.current[roomCat] = null;
    updateRoomState(roomCat, (prev) => ({
      ...prev,
      presetId,
      uploadedPreviewUrl: null,
      uploadedBase64: null,
      uploadedLabel: null,
      imageError: false,
      scanError: null,
    }));
    setSelectedRoom(roomCat);
    setBudgetFilter('all');
  };

  const handleRoomPillClick = (room: (typeof ROOM_PILLS)[number]) => {
    setSelectedRoom(room.id);
    setBudgetFilter('all');
  };

  const handleResetCurrentRoom = () => {
    const targetRoom = selectedRoom;
    revokeBlobUrl(roomStatesRef.current[targetRoom].uploadedPreviewUrl);
    lastScannedSigRef.current[targetRoom] = null;
    updateRoomState(targetRoom, () => createDefaultRoomSlot(targetRoom));
    setBudgetFilter('all');
  };

  const toggleRiskFlag = (flag: RoomRiskFlag) => {
    updateRoomState(selectedRoom, (prev) => ({
      ...prev,
      riskFlags: prev.riskFlags.includes(flag)
        ? prev.riskFlags.filter((f) => f !== flag)
        : [...prev.riskFlags, flag],
    }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    const targetRoom = selectedRoom;
    const prevPreviewUrl = roomStatesRef.current[targetRoom].uploadedPreviewUrl;
    const nextObjectUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;

    updateRoomState(targetRoom, (prev) => ({
      ...prev,
      imageError: false,
      scanError: null,
      isScanning: true,
    }));

    try {
      const compressed = await compressImageToJpeg(file, 1024, 0.8);
      revokeBlobUrl(prevPreviewUrl);
      lastScannedSigRef.current[targetRoom] = null;
      updateRoomState(targetRoom, (prev) => ({
        ...prev,
        uploadedPreviewUrl: nextObjectUrl ?? compressed.dataUrl,
        uploadedBase64: compressed.base64,
        uploadedLabel: file.name.replace(/\.[^.]+$/, ''),
        imageError: false,
      }));
      setBudgetFilter('all');
    } catch {
      revokeBlobUrl(nextObjectUrl);
      updateRoomState(targetRoom, (prev) => ({
        ...prev,
        isScanning: false,
        scanError: 'Could not read that image file. Please try a JPG or PNG photo.',
      }));
    }
  };

  const handleRetryScan = () => {
    void runVisionDiagnosis({
      roomId: selectedRoom,
      source: uploadedPreviewUrl ?? preset.imageUrl,
      precompressedBase64: uploadedBase64,
      roomLabel: activeRoomLabel,
      activeRiskFlags: riskFlags,
      activeCity: city,
      cacheSignature: activeSignature,
      forceRefresh: true,
    });
  };

  // Click Pin on Photo → Highlight + smooth scroll to linked Fix Card with brief Emerald glow ring
  const handlePinClick = (pinId: number) => {
    updateRoomState(selectedRoom, (prev) => ({ ...prev, selectedPinId: pinId }));
    setBudgetFilter('all');
    setGlowingCardId(pinId);
    if (glowTimerRef.current) window.clearTimeout(glowTimerRef.current);
    glowTimerRef.current = window.setTimeout(() => {
      setGlowingCardId(null);
    }, 1150);

    window.requestAnimationFrame(() => {
      cardRefs.current[pinId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  };

  // Click Fix Card → Pulse its corresponding AR pin on the photo
  const handleCardClick = (pinId: number) => {
    updateRoomState(selectedRoom, (prev) => ({ ...prev, selectedPinId: pinId }));
    setPinPulseCounter((prev) => ({
      ...prev,
      [pinId]: (prev[pinId] || 0) + 1,
    }));
  };

  const traps = useMemo(() => diagnosis?.traps ?? [], [diagnosis]);
  const visibleTraps = useMemo(
    () =>
      traps.filter((trap) =>
        budgetFilter === 'all' ? true : mapCategoryToBudget(trap.category) === budgetFilter
      ),
    [traps, budgetFilter]
  );

  const indoorRiskLabel: VisionRiskLevel = diagnosis?.riskLevel ?? 'High';
  const indoorRiskColor = getRiskBadgeStyle(indoorRiskLabel);
  const fixPotential = diagnosis?.fixPotentialPercent ?? 0;

  const sourceSlug = `${selectedRoom}-${
    uploadedLabel
      ? `upload-${uploadedLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      : preset.id
  }`;

  return (
    <div className="space-y-6 pb-32">
      {/* Top Context Strip: Room Pills + Risk Chips */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {ROOM_PILLS.map((r) => {
            const active = selectedRoom === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRoomPillClick(r)}
                className={`apple-press inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap ${
                  active
                    ? 'bg-[#0F172A] text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,0.35)]'
                    : 'glass-card text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <Home className="h-3.5 w-3.5" aria-hidden="true" />
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RISK_CHIPS.map((chip) => {
            const Icon = chip.icon;
            const active = riskFlags.includes(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => toggleRiskFlag(chip.id)}
                aria-pressed={active}
                className={`apple-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold whitespace-nowrap ${
                  active
                    ? 'bg-[#FF3B30] text-white shadow-[0_6px_16px_-4px_rgba(255,59,48,0.4)]'
                    : 'border border-slate-200/90 bg-white/80 text-[#475569] hover:bg-white hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {active ? `✓ ${chip.label.replace('+ ', '')}` : chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 12-Column Split: 7 Left (AI Vision Scanner) / 5 Right (Diagnosis & Tiered Fixes) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* LEFT 7 COLUMNS: Gemini Vision Scanner Card */}
        <section className="glass-card rounded-3xl p-5 lg:col-span-7">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-200/70 ring-1 ring-slate-200/80">
            {!imageError ? (
              <img
                src={activePhotoSrc}
                alt={`${activeContextLabel} indoor air quality vision audit`}
                referrerPolicy="no-referrer"
                onError={() =>
                  updateRoomState(selectedRoom, (prev) => ({ ...prev, imageError: true }))
                }
                className="h-full w-full object-cover transition-transform duration-500"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-200/70 to-emerald-50 text-slate-600">
                <Camera className="h-10 w-10 text-slate-400" aria-hidden="true" />
                <span className="mt-2 font-display text-sm font-semibold">
                  {activeContextLabel} Preview
                </span>
              </div>
            )}

            {/* Subtle top/bottom gradient scrim for legibility */}
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/30 via-transparent to-slate-950/35"
              aria-hidden="true"
            />

            {/* Continuous Vertical Emerald Laser Scanline while Gemini Vision runs */}
            {isScanning && (
              <div
                className="animate-laser-scan-loop pointer-events-none absolute inset-x-0 z-20"
                aria-hidden="true"
              >
                <div className="h-[3px] w-full bg-[#34C759] shadow-[0_0_22px_5px_rgba(52,199,89,0.9)]" />
                <div className="h-16 w-full bg-gradient-to-b from-[#34C759]/28 to-transparent" />
              </div>
            )}

            {/* Top-Left Compact Vision Status Pill */}
            <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full bg-slate-950/75 px-3.5 py-1.5 text-[12px] font-semibold text-white backdrop-blur-xl ring-1 ring-white/20">
              <ScanLine
                className={`h-3.5 w-3.5 text-[#34C759] ${isScanning ? 'animate-pulse' : ''}`}
                aria-hidden="true"
              />
              <span>
                {isScanning
                  ? `Scanning ${activeRoomLabel}...`
                  : scanError
                    ? 'Vision Scan Paused'
                    : `Gemini Vision • ${traps.length} Traps Mapped`}
              </span>
            </div>

            {/* Top-Right Active Room Badge */}
            <div
              data-testid="active-room-badge"
              className="absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11.5px] font-bold text-[#0F172A] shadow-xs backdrop-blur-md ring-1 ring-slate-200/80"
            >
              <span className="h-2 w-2 rounded-full bg-[#34C759]" aria-hidden="true" />
              <span>{activeContextLabel}</span>
            </div>

            {/* Dynamic Pulsing AR Hotspot Pins at Gemini (x%, y%) Coordinates */}
            {!isScanning &&
              traps.map((trap) => {
                const isSelected = selectedPinId === trap.id;
                const burstSeq = pinPulseCounter[trap.id] || 0;
                return (
                  <button
                    key={`${sourceSlug}-pin-${trap.id}`}
                    type="button"
                    onClick={() => handlePinClick(trap.id)}
                    style={{ left: `${trap.x}%`, top: `${trap.y}%` }}
                    aria-label={`Trap ${trap.id}: ${trap.title}`}
                    className="apple-press group absolute z-20 -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none"
                  >
                    {/* Continuous subtle AR pulse */}
                    <span
                      className={`animate-ar-pulse absolute inset-0 rounded-full ${
                        isSelected ? 'bg-[#34C759]' : 'bg-[#FF3B30]'
                      }`}
                      aria-hidden="true"
                    />

                    {/* Amplified shockwave burst when linked Fix Card is clicked */}
                    {burstSeq > 0 && (
                      <span
                        key={`burst-${trap.id}-${burstSeq}`}
                        className="animate-pin-burst pointer-events-none absolute inset-0 rounded-full border-2 border-[#34C759] bg-[#34C759]/35"
                        aria-hidden="true"
                      />
                    )}

                    {/* Core pin badge */}
                    <span
                      className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-white font-display text-[14px] font-extrabold text-white shadow-lg transition-transform duration-200 ${
                        isSelected
                          ? 'scale-115 bg-[#34C759] shadow-[0_0_0_5px_rgba(52,199,89,0.32)]'
                          : 'bg-[#FF3B30] group-hover:scale-110'
                      }`}
                    >
                      {trap.id}
                    </span>

                    {/* Floating Pin Callout Label when selected */}
                    {isSelected && (
                      <span className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2 rounded-full bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-md shadow-md whitespace-nowrap">
                        {trap.title}
                      </span>
                    )}
                  </button>
                );
              })}

            {/* Bottom-Left City Context Pill on photo */}
            <div className="absolute bottom-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/88 px-3 py-1 text-[11px] font-bold text-[#0F172A] backdrop-blur-md shadow-xs tabular-nums-strict">
              <span>
                {city.name} Outdoor: {city.aqi} AQI
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-[#008A84]">CO₂ {city.indoorCo2} ppm</span>
            </div>
          </div>

          {/* Bottom Bar inside Scanner Card: Upload Room Photo + Per-Room Reset + 3 Sample Presets */}
          <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                aria-label={`Upload photo for ${activeRoomLabel}`}
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
                className="apple-press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#0F172A] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Upload {activeRoomLabel} Photo
              </button>

              {uploadedPreviewUrl && (
                <button
                  type="button"
                  onClick={handleResetCurrentRoom}
                  aria-label={`Reset ${activeRoomLabel} photo`}
                  className="apple-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3.5 text-[12px] font-semibold text-[#475569] hover:bg-slate-50 hover:text-[#0F172A] whitespace-nowrap"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Reset Room
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {ROOM_AUDIT_PRESETS.map((item) => {
                const isActive = item.id === activePresetId && !uploadedPreviewUrl;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectPreset(item.id, item.roomType)}
                    className={`apple-press shrink-0 rounded-full px-3.5 py-2 text-[12px] font-semibold whitespace-nowrap ${
                      isActive
                        ? 'bg-[#34C759]/15 text-[#1E8E3E] ring-1 ring-[#34C759]/35'
                        : 'border border-slate-200/80 bg-white/85 text-[#475569] hover:bg-white hover:text-[#0F172A]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT 5 COLUMNS: Gemini Vision Diagnosis Summary & Linked Tiered Fix Cards */}
        <section className="space-y-4 lg:col-span-5">
          {/* Summary Diagnosis Card */}
          <div className="glass-card rounded-3xl p-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#64748B]">
                <Sparkles className="h-3.5 w-3.5 text-[#34C759]" aria-hidden="true" />
                <span>Gemini Vision • {activeContextLabel}</span>
              </div>

              {!isScanning && (
                <button
                  type="button"
                  onClick={handleRetryScan}
                  aria-label={`Re-scan ${activeRoomLabel} with Gemini Vision`}
                  className="apple-press inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-slate-200/80 hover:text-[#0F172A]"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Re-scan
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50/90 p-4 ring-1 ring-slate-200/70">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                  Indoor Risk
                </div>
                <div className="mt-2">
                  {isScanning && !diagnosis ? (
                    <div className="h-8 w-24 animate-pulse rounded-full bg-slate-200/80" />
                  ) : (
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 font-display text-[17px] font-extrabold ring-1 ${indoorRiskColor}`}
                    >
                      {indoorRiskLabel}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-[#34C759]/8 p-4 ring-1 ring-[#34C759]/25">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#15803D]">
                  Fix Potential
                </div>
                <div className="mt-1.5 font-display text-[26px] font-extrabold leading-none tracking-[-0.03em] text-[#15803D]">
                  {isScanning && !diagnosis ? (
                    <div className="h-7 w-24 animate-pulse rounded-lg bg-[#34C759]/20" />
                  ) : (
                    <>
                      <AnimatedNumber value={fixPotential} prefix="-" suffix="%" />
                      <span className="ml-1 text-[13px] font-bold">PM2.5</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Budget Segmented Filter */}
            <div
              role="tablist"
              aria-label="Filter room fixes by budget"
              className="mt-5 flex items-center justify-between rounded-full bg-slate-200/60 p-1"
            >
              {BUDGET_FILTERS.map((f) => {
                const active = budgetFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBudgetFilter(f.id)}
                    className={`apple-press relative flex-1 rounded-full py-1.5 text-center text-[12px] font-semibold whitespace-nowrap ${
                      active ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="auditBudgetPill"
                        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                        className="absolute inset-0 rounded-full bg-white shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clean API Error Fallback with Retry */}
          {scanError && (
            <div
              role="alert"
              className="glass-card rounded-3xl border border-[#FF3B30]/25 bg-[#FF3B30]/6 p-5"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0 text-[#FF3B30]"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[14px] font-bold text-[#0F172A]">
                    Vision Scan Interrupted
                  </h3>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-[#475569]">{scanError}</p>
                  <button
                    type="button"
                    onClick={handleRetryScan}
                    className="apple-press mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry Vision Scan
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Linked Fix Cards (or Clean Shimmer Skeleton while Scanning) */}
          <div className="space-y-3">
            {isScanning && traps.length === 0 ? (
              [1, 2, 3].map((n) => (
                <div key={n} className="glass-card rounded-3xl p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-2.5">
                      <div className="h-3 w-36 animate-pulse rounded-full bg-slate-200" />
                      <div className="h-4 w-56 animate-pulse rounded-full bg-slate-200" />
                      <div className="h-3.5 w-44 animate-pulse rounded-full bg-slate-100" />
                    </div>
                  </div>
                </div>
              ))
            ) : visibleTraps.length === 0 && !scanError ? (
              <div className="glass-card rounded-3xl p-6 text-center text-[13px] font-medium text-[#64748B]">
                No traps in this budget tier for {activeContextLabel}. Switch to All to inspect all
                3 fixes.
              </div>
            ) : (
              visibleTraps.map((trap) => {
                const isSelected = selectedPinId === trap.id;
                const isGlowing = glowingCardId === trap.id;
                const fixKey = `${sourceSlug}-trap-${trap.id}-${trap.title
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')}`;
                const isAdded = addedAuditFixKeys.includes(fixKey);

                return (
                  <article
                    key={fixKey}
                    ref={(el) => {
                      cardRefs.current[trap.id] = el;
                    }}
                    onClick={() => handleCardClick(trap.id)}
                    className={`glass-card glass-card-lift cursor-pointer rounded-3xl p-5 transition-all duration-300 ${
                      isGlowing
                        ? 'bg-white ring-2 ring-[#34C759] shadow-[0_0_0_6px_rgba(52,199,89,0.22),0_18px_36px_-12px_rgba(52,199,89,0.28)]'
                        : isSelected
                          ? 'bg-white/95 ring-2 ring-[#34C759]'
                          : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-extrabold text-white transition-colors ${
                            isSelected ? 'bg-[#34C759]' : 'bg-[#FF3B30]'
                          }`}
                        >
                          {trap.id}
                        </span>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#64748B]">
                              {trap.title}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#0F172A] tabular-nums-strict">
                              {trap.costBadge}
                            </span>
                            <span className="rounded-full bg-[#00C7BE]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#0F766E]">
                              {trap.category}
                            </span>
                          </div>

                          <h3 className="mt-1 font-display text-[15px] font-bold leading-snug text-[#0F172A]">
                            {trap.fixAction}
                          </h3>

                          <p className="mt-1.5 text-[12px] font-medium leading-snug text-[#334155]">
                            <span className="font-bold text-[#15803D]">Why &amp; Impact:</span>{' '}
                            {trap.whyImpact}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <CircularToggle
                          checked={isAdded}
                          onChange={() => onToggleAddVisionFix(fixKey, activeRoomLabel, trap)}
                          ariaLabel={`Add ${trap.fixAction} to Indoor Air Quality Hacks`}
                        />
                        <span className="whitespace-nowrap text-[10px] font-semibold text-[#64748B]">
                          {isAdded ? 'In Hacks' : 'Add'}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

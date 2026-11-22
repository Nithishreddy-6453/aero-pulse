import { useEffect, useState } from 'react';
import { Eye, Layers, MapPin, Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { CityAirProfile, CityHotspot } from '../types/aeropulse';
import { AnimatedNumber } from './AnimatedNumber';

interface AqiHeatmapCardProps {
  city: CityAirProfile;
}

type HeatmapChannel = 'aqi' | 'pm25' | 'no2';

const MAP_IMAGE_SRC = '/src/assets/images/city_map_base_1795276945102.jpg';

function getHotspotColor(value: number, channel: HeatmapChannel) {
  if (channel === 'aqi') {
    if (value >= 300) {
      return {
        hex: '#FF3B30',
        mid: '#FF6B4A',
        badge: 'bg-[#FF3B30] text-white',
        softPill: 'bg-[#FF3B30]/14 text-[#D6281F] ring-[#FF3B30]/30',
        label: 'Severe',
      };
    }
    if (value >= 200) {
      return {
        hex: '#FF5E3A',
        mid: '#FF9500',
        badge: 'bg-[#FF5E3A] text-white',
        softPill: 'bg-[#FF5E3A]/14 text-[#C93B1D] ring-[#FF5E3A]/30',
        label: 'Very Poor',
      };
    }
    if (value >= 101) {
      return {
        hex: '#FF9500',
        mid: '#FFCC00',
        badge: 'bg-[#FF9500] text-white',
        softPill: 'bg-[#FF9500]/16 text-[#B86300] ring-[#FF9500]/30',
        label: 'Moderate',
      };
    }
    return {
      hex: '#34C759',
      mid: '#00C7BE',
      badge: 'bg-[#34C759] text-white',
      softPill: 'bg-[#34C759]/14 text-[#1E8E3E] ring-[#34C759]/30',
      label: 'Good',
    };
  }

  if (channel === 'pm25') {
    if (value >= 180) {
      return {
        hex: '#FF3B30',
        mid: '#FF6B4A',
        badge: 'bg-[#FF3B30] text-white',
        softPill: 'bg-[#FF3B30]/14 text-[#D6281F] ring-[#FF3B30]/30',
        label: 'Severe',
      };
    }
    if (value >= 60) {
      return {
        hex: '#FF9500',
        mid: '#FFCC00',
        badge: 'bg-[#FF9500] text-white',
        softPill: 'bg-[#FF9500]/16 text-[#B86300] ring-[#FF9500]/30',
        label: 'Elevated',
      };
    }
    return {
      hex: '#34C759',
      mid: '#00C7BE',
      badge: 'bg-[#34C759] text-white',
      softPill: 'bg-[#34C759]/14 text-[#1E8E3E] ring-[#34C759]/30',
      label: 'Clean',
    };
  }

  // NO2 channel
  if (value >= 60) {
    return {
      hex: '#FF3B30',
      mid: '#FF9500',
      badge: 'bg-[#FF3B30] text-white',
      softPill: 'bg-[#FF3B30]/14 text-[#D6281F] ring-[#FF3B30]/30',
      label: 'High NO₂',
    };
  }
  if (value >= 32) {
    return {
      hex: '#FF9500',
      mid: '#00C7BE',
      badge: 'bg-[#FF9500] text-white',
      softPill: 'bg-[#FF9500]/16 text-[#B86300] ring-[#FF9500]/30',
      label: 'Moderate',
    };
  }
  return {
    hex: '#00C7BE',
    mid: '#34C759',
    badge: 'bg-[#00C7BE] text-white',
    softPill: 'bg-[#00C7BE]/14 text-[#008A84] ring-[#00C7BE]/30',
    label: 'Low NO₂',
  };
}

export function AqiHeatmapCard({ city }: AqiHeatmapCardProps) {
  const [channel, setChannel] = useState<HeatmapChannel>('aqi');
  const [selectedId, setSelectedId] = useState<string>(city.hotspots[0]?.id ?? '');
  const [vividOverlay, setVividOverlay] = useState<boolean>(true);
  const [imgError, setImgError] = useState<boolean>(false);

  // Reset selected hotspot to peak hotspot whenever city switches
  useEffect(() => {
    setSelectedId(city.hotspots[0]?.id ?? '');
  }, [city.id, city.hotspots]);

  const selectedHotspot: CityHotspot =
    city.hotspots.find((h) => h.id === selectedId) ?? city.hotspots[0];

  const getMetricValue = (h: CityHotspot) =>
    channel === 'aqi' ? h.aqi : channel === 'pm25' ? h.pm25 : h.no2;

  const selectedColor = getHotspotColor(getMetricValue(selectedHotspot), channel);
  const peakHotspot = city.hotspots[0];
  const cleanestHotspot = city.hotspots[city.hotspots.length - 1];

  return (
    <section className="glass-card overflow-hidden rounded-3xl p-5 sm:p-6">
      {/* Top Header Row */}
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[#FF3B30]/12 text-[#FF3B30]">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-[#0F172A]">
              {city.name} AQI Pollution Heatmap
            </h2>
          </div>
          <p className="mt-0.5 text-[13px] text-[#64748B]">
            Thermal gradient overlay across {city.hotspots.length} hyperlocal CPCB monitoring pockets
          </p>
        </div>

        {/* Right Controls: Channel Segmented Pill + Overlay Intensity */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full bg-slate-200/60 p-1">
            {(
              [
                { id: 'aqi', label: 'AQI' },
                { id: 'pm25', label: 'PM2.5' },
                { id: 'no2', label: 'NO₂' },
              ] as const
            ).map((opt) => {
              const active = channel === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setChannel(opt.id)}
                  className={`apple-press relative rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap ${
                    active ? 'text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="heatmapChannelPill"
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
            onClick={() => setVividOverlay((v) => !v)}
            className="apple-press inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-3 text-[12px] font-semibold text-[#334155] hover:bg-white"
          >
            <Eye className="h-3.5 w-3.5 text-[#00C7BE]" aria-hidden="true" />
            {vividOverlay ? 'Overlay: Vivid' : 'Overlay: Subtle'}
          </button>
        </div>
      </div>

      {/* Interactive Map + Color-Coded Gradient Overlay Container */}
      <div className="relative aspect-[16/9] min-h-[300px] w-full overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200/80 sm:min-h-[360px]">
        {/* Base Placeholder Urban Map Image */}
        {!imgError ? (
          <img
            src={MAP_IMAGE_SRC}
            alt={`${city.name} urban map with AQI pollution hotspot heatmap overlay`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-slate-100 via-sky-50 to-emerald-50" />
        )}

        {/* Color-Coded Gradient Heatmap Overlay (SVG Gaussian Blurred Thermal Plumes) */}
        <svg
          viewBox="0 0 100 56.25"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full mix-blend-multiply transition-opacity duration-300"
          style={{ opacity: vividOverlay ? 0.82 : 0.45 }}
        >
          <defs>
            <filter id="thermalBlur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4.2" />
            </filter>
            {city.hotspots.map((spot) => {
              const val = getMetricValue(spot);
              const col = getHotspotColor(val, channel);
              return (
                <radialGradient
                  key={`grad-${spot.id}-${channel}`}
                  id={`plume-${spot.id}`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={col.hex} stopOpacity="0.88" />
                  <stop offset="48%" stopColor={col.mid} stopOpacity="0.46" />
                  <stop offset="100%" stopColor={col.mid} stopOpacity="0" />
                </radialGradient>
              );
            })}
          </defs>

          {/* Subtle citywide atmospheric haze tint */}
          <rect
            x="0"
            y="0"
            width="100"
            height="56.25"
            fill={
              city.severity === 'severe' || city.severity === 'poor'
                ? 'rgba(255, 149, 0, 0.14)'
                : city.severity === 'moderate'
                  ? 'rgba(255, 204, 0, 0.10)'
                  : 'rgba(52, 199, 89, 0.10)'
            }
          />

          {/* Neighborhood thermal pollution plumes */}
          <g filter="url(#thermalBlur)">
            {city.hotspots.map((spot) => (
              <ellipse
                key={`ellipse-${spot.id}`}
                cx={spot.x}
                cy={(spot.y / 100) * 56.25}
                rx={spot.radius}
                ry={spot.radius * 0.62}
                fill={`url(#plume-${spot.id})`}
              />
            ))}
          </g>
        </svg>

        {/* Top-Left Spectrum Gradient Legend */}
        <div className="absolute left-3.5 top-3.5 z-20 flex items-center gap-2.5 rounded-full bg-white/88 px-3.5 py-1.5 shadow-sm backdrop-blur-xl ring-1 ring-slate-200/80">
          <span className="text-[11px] font-bold text-[#1E8E3E]">Good</span>
          <span
            className="h-2 w-24 rounded-full sm:w-32"
            style={{
              background:
                'linear-gradient(90deg, #34C759 0%, #00C7BE 25%, #FF9500 60%, #FF3B30 100%)',
            }}
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold text-[#FF3B30]">Severe</span>
        </div>

        {/* Top-Right Peak vs Cleanest Pocket Pill */}
        <div className="absolute right-3.5 top-3.5 z-20 hidden items-center gap-2 rounded-full bg-white/88 px-3.5 py-1.5 text-[11px] font-semibold text-[#334155] shadow-sm backdrop-blur-xl ring-1 ring-slate-200/80 sm:inline-flex tabular-nums-strict">
          <span className="text-[#FF3B30] font-bold">
            Peak: {peakHotspot.name} ({peakHotspot.aqi})
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-[#1E8E3E] font-bold">
            Cleanest: {cleanestHotspot.name} ({cleanestHotspot.aqi})
          </span>
        </div>

        {/* Clickable Hotspot Pins on the Map */}
        {city.hotspots.map((spot) => {
          const val = getMetricValue(spot);
          const col = getHotspotColor(val, channel);
          const isSelected = spot.id === selectedHotspot.id;

          return (
            <button
              key={spot.id}
              type="button"
              onClick={() => setSelectedId(spot.id)}
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              aria-label={`${spot.name}: ${val} ${channel.toUpperCase()}`}
              className="apple-press group absolute z-20 -translate-x-1/2 -translate-y-1/2 focus-visible:outline-none"
            >
              {isSelected && (
                <span
                  className="animate-ar-pulse absolute -inset-1.5 rounded-full"
                  style={{ backgroundColor: col.hex }}
                  aria-hidden="true"
                />
              )}
              <span
                className={`relative inline-flex items-center gap-1 rounded-full border-2 border-white px-2.5 py-1 font-display text-[12px] font-extrabold shadow-md tabular-nums-strict transition-transform ${
                  col.badge
                } ${isSelected ? 'scale-115 ring-4 ring-white/60' : 'group-hover:scale-110'}`}
              >
                <span>{val}</span>
              </span>
              <span
                className={`pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full bg-white/92 px-2.5 py-0.5 text-[11px] font-bold text-[#0F172A] shadow-xs backdrop-blur-md whitespace-nowrap transition-opacity ${
                  isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100'
                }`}
              >
                {spot.name}
              </span>
            </button>
          );
        })}

        {/* Bottom-Left Frosted Inspector Card for Selected Hotspot */}
        <div className="absolute bottom-3.5 left-3.5 right-3.5 z-20 sm:right-auto sm:max-w-md">
          <div className="glass-floating rounded-2xl p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[#64748B]">
                  <MapPin className="h-3.5 w-3.5 text-[#FF3B30]" aria-hidden="true" />
                  <span className="truncate">{selectedHotspot.zoneType}</span>
                </div>
                <h3 className="mt-0.5 font-display text-[16px] font-extrabold text-[#0F172A]">
                  {selectedHotspot.name}
                </h3>
              </div>

              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${selectedColor.softPill}`}
              >
                {selectedColor.label}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[#0F172A] tabular-nums-strict">
                AQI <AnimatedNumber value={selectedHotspot.aqi} className="font-extrabold" />
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[#334155] tabular-nums-strict">
                PM2.5 <AnimatedNumber value={selectedHotspot.pm25} className="font-bold" />
              </span>
              <span className="rounded-full bg-[#00C7BE]/12 px-2.5 py-0.5 text-[#008A84] tabular-nums-strict">
                <Wind className="mr-1 inline h-3 w-3" aria-hidden="true" />
                NO₂ <AnimatedNumber value={selectedHotspot.no2} className="font-bold" />
              </span>
            </div>

            <p className="mt-2 text-[12px] font-medium leading-snug text-[#475569]">
              {selectedHotspot.note}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

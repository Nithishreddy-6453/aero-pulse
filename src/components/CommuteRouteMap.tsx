import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, Navigation } from 'lucide-react';
import {
  CityAirProfile,
  CommuteAnalysisResult,
  CommuteMode,
  RouteOptionMetrics,
} from '../types/aeropulse';

interface CommuteRouteMapProps {
  city: CityAirProfile;
  analysis: CommuteAnalysisResult | null;
  selectedMode: CommuteMode;
  isLoadingRoute: boolean;
  originLabel: string;
  destinationLabel: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSeverityDotClass(severity: CityAirProfile['severity']): string {
  if (severity === 'severe' || severity === 'poor') return 'bg-[#FF3B30]';
  if (severity === 'moderate') return 'bg-[#FF9500]';
  return 'bg-[#34C759]';
}

function getActiveRoute(
  analysis: CommuteAnalysisResult | null,
  selectedMode: CommuteMode
): RouteOptionMetrics | null {
  if (!analysis) return null;
  if (selectedMode === 'metro' && analysis.routes.transit.available) {
    return analysis.routes.transit;
  }
  if (selectedMode === 'two-wheeler' && analysis.routes.twoWheeler.available) {
    return analysis.routes.twoWheeler;
  }
  if (analysis.routes.drive.available) {
    return analysis.routes.drive;
  }
  return null;
}

function createMarkerIcon(badge: 'A' | 'B', label: string, badgeBg: string, isDark: boolean) {
  const safeLabel = escapeHtml(label);
  const pillClasses = isDark
    ? 'background:rgba(15,23,42,0.94);color:#ffffff;border:1px solid rgba(255,255,255,0.92);box-shadow:0 6px 18px rgba(15,23,42,0.24);'
    : 'background:rgba(255,255,255,0.96);color:#0f172a;border:1px solid rgba(255,255,255,0.96);box-shadow:0 6px 18px rgba(15,23,42,0.18);';

  return L.divIcon({
    className: 'aeropulse-map-marker',
    html: `
      <div style="display:inline-flex;align-items:center;gap:6px;border-radius:9999px;padding:4px 10px 4px 5px;font-size:11px;font-weight:700;white-space:nowrap;transform:translate(-50%,-100%);backdrop-filter:blur(10px);${pillClasses}">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:9999px;background:${badgeBg};color:#ffffff;font-size:10px;font-weight:800;flex-shrink:0;">
          ${badge}
        </span>
        <span style="max-width:118px;overflow:hidden;text-overflow:ellipsis;">${safeLabel}</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, -6],
  });
}

export function CommuteRouteMap({
  city,
  analysis,
  selectedMode,
  isLoadingRoute,
  originLabel,
  destinationLabel,
}: CommuteRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const activeRoute = useMemo(
    () => getActiveRoute(analysis, selectedMode),
    [analysis, selectedMode]
  );

  const isLowEmission = selectedMode === 'metro' || selectedMode === 'carpool';
  const shortOrigin = originLabel.split(',')[0].trim() || 'Origin';
  const shortDestination = destinationLabel.split(',')[0].trim() || 'Destination';

  // Initialize Leaflet Map + OpenStreetMap Light Theme once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [city.center.lat, city.center.lng],
      zoom: 12,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    routeLayerGroupRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      routeLayerGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update OSRM Route Polyline, Origin/Destination Pill Markers, and Auto-Fit Bounds
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = routeLayerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    if (!activeRoute || activeRoute.coordinates.length < 2) {
      map.setView([city.center.lat, city.center.lng], 12, { animate: true });
      return;
    }

    const strokeColor = isLowEmission ? '#34C759' : '#FF3B30';
    const haloColor = isLowEmission ? 'rgba(52, 199, 89, 0.24)' : 'rgba(255, 59, 48, 0.24)';

    // Soft outer halo polyline
    L.polyline(activeRoute.coordinates, {
      color: haloColor,
      weight: 12,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layerGroup);

    // Crisp Apple-style route stroke
    const mainLine = L.polyline(activeRoute.coordinates, {
      color: strokeColor,
      weight: 5,
      opacity: 0.96,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layerGroup);

    // Origin & Destination markers
    if (activeRoute.startLocation) {
      L.marker([activeRoute.startLocation.lat, activeRoute.startLocation.lng], {
        icon: createMarkerIcon('A', shortOrigin, '#34C759', false),
        keyboard: false,
      }).addTo(layerGroup);
    }

    if (activeRoute.endLocation) {
      L.marker([activeRoute.endLocation.lat, activeRoute.endLocation.lng], {
        icon: createMarkerIcon(
          'B',
          shortDestination,
          isLowEmission ? '#00C7BE' : '#FF3B30',
          true
        ),
        keyboard: false,
      }).addTo(layerGroup);
    }

    const bounds = mainLine.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        paddingTopLeft: [36, 84],
        paddingBottomRight: [44, 40],
        animate: true,
        duration: 0.5,
      });
    }
  }, [activeRoute, city.center.lat, city.center.lng, isLowEmission, shortOrigin, shortDestination]);

  const summaryExposureText = useMemo(() => {
    if (!analysis) {
      return `${city.aqi} AQI · Enter locations to plot route`;
    }
    if (isLowEmission) {
      return `${analysis.recommended.distanceKm} km · ${analysis.recommended.durationMins} min · ~${analysis.recommended.exposureAqi} AQI cabin`;
    }
    return `${analysis.highRisk.distanceKm} km · ${analysis.highRisk.durationMins} min · ${analysis.highRisk.exposureAqi} AQI roadside`;
  }, [analysis, city.aqi, isLowEmission]);

  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-100 shadow-xs sm:h-[348px]">
      {/* Leaflet.js + CartoDB Positron Light Canvas */}
      <div
        ref={mapContainerRef}
        className="h-full w-full z-0"
        aria-label={`Interactive route map for ${city.name}`}
      />

      {/* Subtle Top-Left Frosted-Glass Pill: City AQI + Route Exposure Summary */}
      <div className="pointer-events-none absolute left-3.5 top-3.5 z-[500] max-w-[calc(100%-28px)]">
        <div className="glass-floating inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl px-3.5 py-2 text-[12px] font-semibold text-[#0F172A]">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`h-2 w-2 rounded-full ${getSeverityDotClass(city.severity)}`}
              aria-hidden="true"
            />
            <span className="font-display font-extrabold tabular-nums-strict">
              {city.name} · {city.aqi} AQI
            </span>
          </span>

          <span className="h-3.5 w-px bg-slate-300/80" aria-hidden="true" />

          <span className="inline-flex items-center gap-1.5 text-[#334155] tabular-nums-strict">
            {isLoadingRoute ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00C7BE]" aria-hidden="true" />
                <span>Calculating OSRM route…</span>
              </>
            ) : (
              <>
                <Navigation
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isLowEmission ? 'text-[#34C759]' : 'text-[#FF3B30]'
                  }`}
                  aria-hidden="true"
                />
                <span>{summaryExposureText}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

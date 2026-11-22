import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { searchIndianCities } from '../services/airQuality';
import { AeroTab, CityAirProfile, IndianCitySearchResult } from '../types/aeropulse';

interface TopNavbarProps {
  cities: CityAirProfile[];
  selectedCity: CityAirProfile;
  onSelectCity: (cityId: string) => void;
  onSelectSearchedCity: (place: IndianCitySearchResult) => void;
  activeTab: AeroTab;
  onSelectTab: (tab: AeroTab) => void;
  onLocateGps: () => void;
  isLocating: boolean;
  isSyncingAqi: boolean;
  lastSyncedLabel: string;
  onRefreshSync: () => void;
}

const TABS: { id: AeroTab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'room-audit', label: 'Room Audit' },
  { id: 'commute', label: 'Commute & Impact' },
];

function getSeverityDotColor(city: CityAirProfile) {
  if (!city.isLive) return 'bg-slate-300';
  if (city.severity === 'severe' || city.severity === 'poor') return 'bg-[#FF3B30]';
  if (city.severity === 'moderate') return 'bg-[#FF9500]';
  return 'bg-[#34C759]';
}

export function TopNavbar({
  cities,
  selectedCity,
  onSelectCity,
  onSelectSearchedCity,
  activeTab,
  onSelectTab,
  onLocateGps,
  isLocating,
  isSyncingAqi,
  lastSyncedLabel,
  onRefreshSync,
}: TopNavbarProps) {
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<IndianCitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCityMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (cityMenuOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    } else {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [cityMenuOpen]);

  // Debounced Open-Meteo Free Geocoding API search across India (cached & sanitized)
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchIndianCities(trimmed, controller.signal);
        if (!controller.signal.aborted) {
          setSearchResults(results);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const showSearchMode = searchQuery.trim().length >= 2;

  return (
    <header className="glass-nav sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Zone 1 (Left): Minimal AeroPulse Brand Mark + City Selector + GPS */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('today')}
            className="apple-press flex items-center gap-2.5 rounded-xl pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34C759]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F172A] to-[#334155] text-white shadow-sm">
              <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
                <path
                  d="M3 13.5C5.5 13.5 6.8 8 9.2 8C11.5 8 12.2 16 14.5 16C16.8 16 18 11.5 21 11.5"
                  stroke="#34C759"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="20.5" cy="11.5" r="1.6" fill="#00C7BE" />
              </svg>
            </span>
            <span className="font-display text-[17px] font-bold tracking-[-0.03em] text-[#0F172A] whitespace-nowrap">
              AeroPulse
            </span>
          </button>

          <span className="hidden h-5 w-px bg-slate-200/90 sm:inline-block" aria-hidden="true" />

          {/* Interactive Pan-India City Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setCityMenuOpen((o) => !o)}
              aria-expanded={cityMenuOpen}
              aria-haspopup="listbox"
              className="apple-press inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/85 px-3 text-[13px] font-semibold text-[#0F172A] shadow-xs hover:bg-white whitespace-nowrap"
            >
              <MapPin className="h-3.5 w-3.5 text-[#FF3B30] shrink-0" aria-hidden="true" />
              <span>
                {selectedCity.name}, IN
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[#64748B] transition-transform duration-200 ${
                  cityMenuOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {cityMenuOpen && (
              <div
                role="listbox"
                aria-label="Select or search any Indian city"
                className="glass-floating absolute left-0 mt-2 w-72 overflow-hidden rounded-2xl p-2 z-50"
              >
                {/* Open-Meteo Free Geocoding Indian City Search */}
                <div className="relative mb-2">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search any Indian city..."
                    aria-label="Search any Indian city"
                    className="h-9 w-full rounded-xl border border-slate-200/90 bg-slate-50/90 pl-8.5 pr-8 text-[12.5px] font-medium text-[#0F172A] placeholder:text-[#64748B] focus:border-[#34C759] focus:bg-white focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear city search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[#64748B] hover:bg-slate-200/70 hover:text-[#0F172A]"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {showSearchMode ? (
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                      Pan-India Search Results
                    </div>
                    {isSearching ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-[12px] font-medium text-[#64748B]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00C7BE]" />
                        Searching Open-Meteo India...
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] font-medium text-[#64748B]">
                        No Indian cities matched &ldquo;{searchQuery}&rdquo;.
                      </div>
                    ) : (
                      searchResults.map((place) => (
                        <button
                          key={place.id}
                          type="button"
                          onClick={() => {
                            onSelectSearchedCity(place);
                            setCityMenuOpen(false);
                          }}
                          className="apple-press flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-[#0F172A] hover:bg-slate-100/90"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{place.name}</div>
                            <div className="truncate text-[11px] font-medium text-[#64748B]">
                              {place.state}, India
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-[#34C759]/12 px-2 py-0.5 text-[10px] font-bold text-[#1E8E3E]">
                            Live AQI
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
                      Major Indian Cities
                    </div>
                    {cities.map((city) => {
                      const isActive = city.id === selectedCity.id;
                      return (
                        <button
                          key={city.id}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            onSelectCity(city.id);
                            setCityMenuOpen(false);
                          }}
                          className={`apple-press flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-[#0F172A] hover:bg-slate-100/90'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${getSeverityDotColor(city)}`}
                              aria-hidden="true"
                            />
                            <span className="truncate font-semibold">{city.name}</span>
                            <span
                              className={`truncate text-[11px] font-medium ${
                                isActive ? 'text-white/65' : 'text-[#64748B]'
                              }`}
                            >
                              {city.state}
                            </span>
                          </div>
                          <span
                            className={`tabular-nums-strict shrink-0 text-[11.5px] font-bold ${
                              isActive ? 'text-white/95' : 'text-[#64748B]'
                            }`}
                          >
                            {city.isLive ? `${city.aqi} AQI` : 'Live'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* GPS Icon Button */}
          <button
            type="button"
            onClick={onLocateGps}
            title="Auto-detect your Indian city & live Open-Meteo AQI"
            aria-label="Use GPS to detect your current city"
            className="apple-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/85 text-[#475569] shadow-xs hover:bg-white hover:text-[#0F172A] shrink-0"
          >
            <Crosshair
              className={`h-4 w-4 ${isLocating ? 'animate-spin text-[#00C7BE]' : ''}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Zone 2 (Center): Apple Segmented Control with Sliding White Pill */}
        <nav
          aria-label="Primary sections"
          role="tablist"
          className="hidden items-center rounded-full border border-slate-200/70 bg-slate-200/55 p-1 md:flex"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTab(tab.id)}
                className={`apple-press relative rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  isActive ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeNavPill"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3 (Right): Live Data Source & Exact Timestamp Transparency Pill */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onRefreshSync}
            disabled={isSyncingAqi}
            aria-live="polite"
            aria-label={`Live air quality data source Open-Meteo CPCB Grid, ${isSyncingAqi ? 'syncing live' : lastSyncedLabel}. Click to refresh.`}
            title="Click to refresh live Open-Meteo Air Quality telemetry"
            className="apple-press inline-flex h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white/88 px-3.5 text-[12px] font-medium text-[#475569] shadow-xs hover:bg-white whitespace-nowrap shrink-0 disabled:opacity-75"
          >
            {isSyncingAqi ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#0F766E]" aria-hidden="true" />
            ) : (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34C759] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34C759]" />
              </span>
            )}
            <span className="hidden font-semibold text-[#334155] sm:inline">
              Open-Meteo <span className="hidden xl:inline">/ CPCB Grid</span>
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
              •
            </span>
            <span className="tabular-nums-strict font-bold text-[#0F172A]">
              {isSyncingAqi ? 'Syncing live...' : lastSyncedLabel}
            </span>
          </button>
        </div>
      </div>

      {/* Compact Mobile Segmented Bar */}
      <nav aria-label="Mobile sections" className="border-t border-slate-200/60 px-4 py-2 md:hidden">
        <div role="tablist" className="flex items-center justify-between rounded-full bg-slate-200/60 p-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTab(tab.id)}
                className={`apple-press flex-1 rounded-full py-1.5 text-center text-[12px] font-semibold whitespace-nowrap ${
                  isActive
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

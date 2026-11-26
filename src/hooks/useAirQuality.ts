import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyLiveAirQualityToCity,
  createDynamicIndianCity,
  INDIAN_CITIES,
} from '../data/indianCities';
import { fetchLiveAirQuality, reverseGeocodeIndianCoords } from '../services/airQuality';
import { CityAirProfile, IndianCitySearchResult } from '../types/aeropulse';
import { PersistedAeroPulseState } from '../utils/storage';

export const PRESET_CITY_IDS = new Set(INDIAN_CITIES.map((c) => c.id));

function matchPresetCityId(detectedCity: string): string | null {
  const norm = detectedCity.toLowerCase();
  if (/delhi|new delhi|gurgaon|gurugram|noida|faridabad|ghaziabad/.test(norm)) {
    return 'new-delhi';
  }
  if (/bhubaneswar|cuttack|khordha/.test(norm)) {
    return 'bhubaneswar';
  }
  if (/mumbai|bombay|thane|navi mumbai|bandra|andheri/.test(norm)) {
    return 'mumbai';
  }
  if (/bengaluru|bangalore/.test(norm)) {
    return 'bengaluru';
  }
  if (/kolkata|calcutta|howrah|salt lake|bidhannagar/.test(norm)) {
    return 'kolkata';
  }
  if (/lucknow/.test(norm)) {
    return 'lucknow';
  }
  if (/hyderabad|secunderabad|cyberabad|gachibowli/.test(norm)) {
    return 'hyderabad';
  }
  if (/chennai|madras/.test(norm)) {
    return 'chennai';
  }
  return null;
}

interface UseAirQualityOptions {
  initialSaved: Partial<PersistedAeroPulseState> | null;
  showToast: (message: string) => void;
  onForceRefreshCity?: (cityId: string) => void;
}

export function useAirQuality({
  initialSaved,
  showToast,
  onForceRefreshCity,
}: UseAirQualityOptions) {
  const [cities, setCities] = useState<CityAirProfile[]>(() => {
    const custom = initialSaved?.customCity;
    if (custom && !PRESET_CITY_IDS.has(custom.id)) {
      const restored = createDynamicIndianCity({
        id: custom.id,
        name: custom.name,
        state: custom.state,
        lat: custom.lat,
        lng: custom.lng,
      });
      return [
        {
          ...restored,
          defaultOrigin: custom.defaultOrigin || restored.defaultOrigin,
          defaultDestination: custom.defaultDestination || restored.defaultDestination,
          colonyName: custom.colonyName || restored.colonyName,
        },
        ...INDIAN_CITIES,
      ];
    }
    return INDIAN_CITIES;
  });

  const [selectedCityId, setSelectedCityId] = useState<string>(() => {
    const savedId = initialSaved?.selectedCityId;
    if (savedId && (PRESET_CITY_IDS.has(savedId) || initialSaved?.customCity?.id === savedId)) {
      return savedId;
    }
    return INDIAN_CITIES[0].id;
  });

  const [isLocating, setIsLocating] = useState(false);
  const [isSyncingAqi, setIsSyncingAqi] = useState(false);
  const [liveAqiError, setLiveAqiError] = useState<string | null>(null);
  const [lastSyncedLabel, setLastSyncedLabel] = useState('Syncing...');

  const aqiFetchSeqRef = useRef(0);
  const onForceRefreshCityRef = useRef(onForceRefreshCity);
  onForceRefreshCityRef.current = onForceRefreshCity;

  const selectedCity = useMemo(
    () => cities.find((c) => c.id === selectedCityId) ?? cities[0],
    [cities, selectedCityId]
  );

  // Fetch live Open-Meteo Air Quality telemetry for any city coordinates (with client TTL cache)
  const fetchLiveAqi = useCallback(
    async (
      cityId: string,
      lat: number,
      lng: number,
      options?: { forceRefresh?: boolean; toastCityName?: string }
    ) => {
      const seq = ++aqiFetchSeqRef.current;
      setIsSyncingAqi(true);
      setLiveAqiError(null);

      try {
        const liveData = await fetchLiveAirQuality(lat, lng, {
          forceRefresh: options?.forceRefresh,
        });

        if (seq !== aqiFetchSeqRef.current) return;

        setCities((prev) =>
          prev.map((c) => (c.id === cityId ? applyLiveAirQualityToCity(c, liveData) : c))
        );
        setLastSyncedLabel(liveData.fetchedAtLabel);

        if (options?.forceRefresh) {
          onForceRefreshCityRef.current?.(cityId);
          if (options.toastCityName) {
            showToast(
              `Synced live Open-Meteo AQI for ${options.toastCityName}: ${liveData.aqi} US AQI`
            );
          }
        }
      } catch (err) {
        if (seq !== aqiFetchSeqRef.current) return;
        setLiveAqiError(
          err instanceof Error
            ? err.message
            : 'Unable to reach live Open-Meteo Air Quality API. Tap retry.'
        );
      } finally {
        if (seq === aqiFetchSeqRef.current) {
          setIsSyncingAqi(false);
        }
      }
    },
    [showToast]
  );

  // Trigger live Open-Meteo fetch automatically whenever selected city changes (if not yet live)
  useEffect(() => {
    if (!selectedCity.isLive) {
      void fetchLiveAqi(selectedCity.id, selectedCity.center.lat, selectedCity.center.lng);
    } else if (selectedCity.fetchedAtLabel) {
      setLastSyncedLabel(selectedCity.fetchedAtLabel);
    }
  }, [
    selectedCity.id,
    selectedCity.isLive,
    selectedCity.center.lat,
    selectedCity.center.lng,
    selectedCity.fetchedAtLabel,
    fetchLiveAqi,
  ]);

  const handleSelectCity = useCallback(
    (cityId: string) => {
      setSelectedCityId(cityId);
      const target = cities.find((c) => c.id === cityId);
      if (target && !target.isLive) {
        void fetchLiveAqi(target.id, target.center.lat, target.center.lng);
      } else if (target?.fetchedAtLabel) {
        setLastSyncedLabel(target.fetchedAtLabel);
      }
    },
    [cities, fetchLiveAqi]
  );

  const handleSelectSearchedCity = useCallback(
    (place: IndianCitySearchResult) => {
      const existingPresetId = matchPresetCityId(place.name);
      const existingById = cities.find(
        (c) =>
          c.id === place.id ||
          (existingPresetId && c.id === existingPresetId) ||
          c.name.toLowerCase() === place.name.toLowerCase()
      );

      if (existingById) {
        setSelectedCityId(existingById.id);
        void fetchLiveAqi(existingById.id, existingById.center.lat, existingById.center.lng);
        showToast(`Loading live Open-Meteo AQI for ${existingById.name}`);
        return;
      }

      const dynamicCity = createDynamicIndianCity({
        id: place.id,
        name: place.name,
        state: place.state,
        lat: place.lat,
        lng: place.lng,
      });

      setCities((prev) => [dynamicCity, ...prev]);
      setSelectedCityId(dynamicCity.id);
      void fetchLiveAqi(dynamicCity.id, place.lat, place.lng);
      showToast(`Loading live Open-Meteo AQI for ${place.name}, ${place.state}`);
    },
    [cities, fetchLiveAqi, showToast]
  );

  const handleLocateGps = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('Browser geolocation is unavailable on this device.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;

        try {
          const data = await reverseGeocodeIndianCoords(lat, lng);

          const matchedId = matchPresetCityId(data.city);
          if (matchedId) {
            setCities((prev) =>
              prev.map((c) =>
                c.id === matchedId
                  ? {
                      ...c,
                      center: { lat, lng },
                      isLive: false,
                      defaultOrigin: data.locality
                        ? `${data.locality}, ${data.city}`
                        : c.defaultOrigin,
                    }
                  : c
              )
            );
            setSelectedCityId(matchedId);
            await fetchLiveAqi(matchedId, lat, lng, { forceRefresh: true });
            showToast(
              `Located ${data.locality ? `${data.locality}, ` : ''}${data.city} • Live AQI synced`
            );
          } else {
            const detectedId = `gps-${data.city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const detectedProfile = createDynamicIndianCity({
              id: detectedId,
              name: data.city,
              state: data.state || 'India',
              lat,
              lng,
              locality: data.locality,
            });

            setCities((prev) => {
              const withoutOld = prev.filter((c) => !c.id.startsWith('gps-'));
              return [detectedProfile, ...withoutOld];
            });
            setSelectedCityId(detectedId);
            await fetchLiveAqi(detectedId, lat, lng, { forceRefresh: true });
            showToast(
              `Located ${data.locality ? `${data.locality}, ` : ''}${data.city} • Live AQI synced`
            );
          }
        } catch (err) {
          showToast(
            err instanceof Error
              ? err.message
              : 'Unable to reach reverse geocoding service.'
          );
        } finally {
          setIsLocating(false);
        }
      },
      (geoError) => {
        setIsLocating(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          showToast('Location permission denied — search or pick your Indian city.');
        } else {
          showToast('Could not read GPS position — try again or search your city.');
        }
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 }
    );
  }, [fetchLiveAqi, showToast]);

  const handleRefreshSync = useCallback(() => {
    void fetchLiveAqi(selectedCity.id, selectedCity.center.lat, selectedCity.center.lng, {
      forceRefresh: true,
      toastCityName: selectedCity.name,
    });
  }, [fetchLiveAqi, selectedCity.id, selectedCity.center.lat, selectedCity.center.lng, selectedCity.name]);

  return {
    cities,
    selectedCityId,
    selectedCity,
    isLocating,
    isSyncingAqi,
    liveAqiError,
    lastSyncedLabel,
    handleSelectCity,
    handleSelectSearchedCity,
    handleLocateGps,
    handleRefreshSync,
  };
}

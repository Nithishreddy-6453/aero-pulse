// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingCopilot } from '../FloatingCopilot';
import { RoomAuditTab } from '../RoomAuditTab';
import { SevereSmogBanner } from '../SevereSmogBanner';
import { TabErrorBoundary } from '../TabErrorBoundary';
import { TodayTab } from '../TodayTab';
import { TopNavbar } from '../TopNavbar';
import { INDIAN_CITIES, INITIAL_INDOOR_HACKS } from '../../data/indianCities';
import * as geminiService from '../../services/gemini';
import {
  AeroTab,
  CityAirProfile,
  IndoorHack,
  LiveAppContext,
  RoomVisionDiagnosis,
  RoomVisionTrap,
} from '../../types/aeropulse';

function createLiveCity(overrides: Partial<CityAirProfile> = {}): CityAirProfile {
  return {
    ...INDIAN_CITIES[0],
    aqi: 185,
    severity: 'poor',
    severityLabel: 'POOR',
    pm25: 92.4,
    pm10: 148.0,
    no2: 34.2,
    o3: 41.0,
    indoorCo2: 760,
    isLive: true,
    safeWindowLabel: '2 PM – 4 PM',
    safeStartIdx: 8,
    safeEndIdx: 9,
    hourlyTimeline: [
      { hourLabel: '6:00 AM', shortLabel: '6A', aqi: 240, pm25: 130, status: 'peak' },
      { hourLabel: '7:00 AM', shortLabel: '7A', aqi: 220, pm25: 118, status: 'peak' },
      { hourLabel: '2:00 PM', shortLabel: '2P', aqi: 130, pm25: 62, status: 'safe' },
      { hourLabel: '3:00 PM', shortLabel: '3P', aqi: 135, pm25: 65, status: 'safe' },
    ],
    fetchedAtLabel: 'Updated 10:45 AM IST',
    ...overrides,
  };
}

function mockBrowserImageAndCanvas() {
  class MockImage {
    naturalWidth = 800;
    naturalHeight = 600;
    width = 800;
    height = 600;
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_val: string) {
      window.setTimeout(() => {
        this.onload?.();
      }, 0);
    }
  }

  vi.stubGlobal('Image', MockImage);

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '#FFFFFF',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/'
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AeroPulse Component & Integration Tests', () => {
  it('1. renders Severe Smog Emergency Banner when live AQI >= 300 and hides it when AQI < 300', async () => {
    const onToggleCheck = vi.fn();
    const onAlertFamily = vi.fn();

    const severeCity = createLiveCity({
      name: 'New Delhi',
      aqi: 342,
      severity: 'severe',
      severityLabel: 'SEVERE',
    });

    const { rerender } = render(
      <SevereSmogBanner
        city={severeCity}
        checkedIds={[]}
        onToggleCheck={onToggleCheck}
        onAlertFamily={onAlertFamily}
      />
    );

    expect(screen.getByText(/SEVERE SMOG PROTOCOL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seal Windows/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Purifier Turbo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Outdoor Play/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Alert Family/i }));
    expect(onAlertFamily).toHaveBeenCalledTimes(1);

    // Boundary check: AQI 299 stays hidden
    rerender(
      <SevereSmogBanner
        city={createLiveCity({ aqi: 299, severity: 'severe', severityLabel: 'SEVERE' })}
        checkedIds={[]}
        onToggleCheck={onToggleCheck}
        onAlertFamily={onAlertFamily}
      />
    );
    await waitFor(() => {
      expect(screen.queryByText(/SEVERE SMOG PROTOCOL/i)).not.toBeInTheDocument();
    });

    // Moderate AQI stays hidden on fresh render
    cleanup();
    render(
      <SevereSmogBanner
        city={createLiveCity({ aqi: 84, severity: 'moderate', severityLabel: 'MODERATE' })}
        checkedIds={[]}
        onToggleCheck={onToggleCheck}
        onAlertFamily={onAlertFamily}
      />
    );
    expect(screen.queryByText(/SEVERE SMOG PROTOCOL/i)).not.toBeInTheDocument();
  });

  it('2. updates active ARIA tab state when switching between Today, Room Audit, and Commute & Impact', () => {
    const city = createLiveCity();

    function NavbarTabHarness() {
      const [activeTab, setActiveTab] = useState<AeroTab>('today');
      return (
        <TopNavbar
          cities={[city]}
          selectedCity={city}
          onSelectCity={vi.fn()}
          onSelectSearchedCity={vi.fn()}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onLocateGps={vi.fn()}
          isLocating={false}
          isSyncingAqi={false}
          lastSyncedLabel="Updated 10:45 AM IST"
          onRefreshSync={vi.fn()}
        />
      );
    }

    render(<NavbarTabHarness />);

    const getPrimaryTab = (label: RegExp) => screen.getAllByRole('tab', { name: label })[0];

    expect(getPrimaryTab(/^Today$/i)).toHaveAttribute('aria-selected', 'true');
    expect(getPrimaryTab(/^Room Audit$/i)).toHaveAttribute('aria-selected', 'false');
    expect(getPrimaryTab(/^Commute & Impact$/i)).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(getPrimaryTab(/^Room Audit$/i));
    expect(getPrimaryTab(/^Today$/i)).toHaveAttribute('aria-selected', 'false');
    expect(getPrimaryTab(/^Room Audit$/i)).toHaveAttribute('aria-selected', 'true');
    expect(getPrimaryTab(/^Commute & Impact$/i)).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(getPrimaryTab(/^Commute & Impact$/i));
    expect(getPrimaryTab(/^Today$/i)).toHaveAttribute('aria-selected', 'false');
    expect(getPrimaryTab(/^Room Audit$/i)).toHaveAttribute('aria-selected', 'false');
    expect(getPrimaryTab(/^Commute & Impact$/i)).toHaveAttribute('aria-selected', 'true');
  });

  it('3. syncs a Room Audit fix into Today tab Indoor Air Quality Hacks when Add is toggled', async () => {
    mockBrowserImageAndCanvas();

    const mockDiagnosis: RoomVisionDiagnosis = {
      riskLevel: 'High',
      fixPotentialPercent: 58,
      traps: [
        {
          id: 1,
          title: 'Balcony Door Gap',
          x: 34,
          y: 48,
          category: 'DIY',
          costBadge: '₹280',
          fixAction: 'Seal balcony door draft strip',
          whyImpact: 'Blocks outdoor road PM2.5 seepage by up to 42%.',
        },
        {
          id: 2,
          title: 'Stale Corner Dust',
          x: 68,
          y: 62,
          category: 'Free',
          costBadge: 'Free',
          fixAction: 'Wet-mop floor before sunset',
          whyImpact: 'Prevents settled PM10 from re-suspending indoors.',
        },
        {
          id: 3,
          title: 'Missing HEPA Filter',
          x: 52,
          y: 35,
          category: 'Smart',
          costBadge: 'Smart',
          fixAction: 'Run compact HEPA purifier overnight',
          whyImpact: 'Maintains safe bedroom PM2.5 during inversion peaks.',
        },
      ],
    };

    vi.spyOn(geminiService, 'analyzeRoomPhotoWithGemini').mockResolvedValue(mockDiagnosis);

    const city = createLiveCity();

    function CrossTabSyncHarness() {
      const [tab, setTab] = useState<'room-audit' | 'today'>('room-audit');
      const [hacks, setHacks] = useState<IndoorHack[]>(INITIAL_INDOOR_HACKS);
      const [addedKeys, setAddedKeys] = useState<string[]>([]);

      const handleToggleAddVisionFix = (
        fixKey: string,
        roomLabel: string,
        trap: RoomVisionTrap
      ) => {
        const hackId = `room-audit-${fixKey}`;
        if (addedKeys.includes(fixKey)) {
          setAddedKeys((prev) => prev.filter((k) => k !== fixKey));
          setHacks((prev) => prev.filter((h) => h.id !== hackId));
        } else {
          setAddedKeys((prev) => [...prev, fixKey]);
          const budget: IndoorHack['budget'] =
            trap.category === 'Free' ? 'free' : trap.category === 'DIY' ? 'diy' : 'smart';
          setHacks((prev) => [
            {
              id: hackId,
              title: trap.fixAction,
              budget,
              priceLabel: trap.costBadge,
              impactPill: trap.title,
              whyText: trap.whyImpact,
              completed: false,
              source: 'room-audit',
              auditRoomLabel: roomLabel,
            },
            ...prev,
          ]);
        }
      };

      return (
        <div>
          <button type="button" onClick={() => setTab('today')}>
            Go To Today
          </button>
          {tab === 'room-audit' ? (
            <RoomAuditTab
              city={city}
              addedAuditFixKeys={addedKeys}
              onToggleAddVisionFix={handleToggleAddVisionFix}
            />
          ) : (
            <TodayTab
              city={city}
              isLoadingLiveAqi={false}
              liveAqiError={null}
              onRetryLiveAqi={vi.fn()}
              persona="parent"
              onSelectPersona={vi.fn()}
              modifiers={[]}
              onToggleModifier={vi.fn()}
              advisory={{
                heroVerdict: 'Limit prolonged outdoor exertion until 2 PM.',
                asthmaTip: '',
                gasStoveTip: '',
                routines: [],
              }}
              isLoadingAdvisory={false}
              advisoryError={null}
              onRetryAdvisory={vi.fn()}
              onToggleRoutine={vi.fn()}
              hacks={hacks}
              onToggleHack={vi.fn()}
            />
          )}
        </div>
      );
    }

    render(<CrossTabSyncHarness />);

    const addToggle = await screen.findByRole('checkbox', {
      name: /Add Seal balcony door draft strip to Indoor Air Quality Hacks/i,
    });
    expect(addToggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(addToggle);
    expect(addToggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Go To Today/i }));

    expect(screen.getByText('Seal balcony door draft strip')).toBeInTheDocument();
    expect(screen.getByText(/From Room Audit/i)).toBeInTheDocument();
  });

  it('4. renders frosted-glass Retry banners cleanly on API failures and recovers via Error Boundary', async () => {
    const onRetryLiveAqi = vi.fn();
    const onRetryAdvisory = vi.fn();

    // 4a. TodayTab live Open-Meteo & Gemini failure states
    const offlineCity = createLiveCity({ isLive: false, aqi: 0, hourlyTimeline: [] });
    const { unmount } = render(
      <TodayTab
        city={offlineCity}
        isLoadingLiveAqi={false}
        liveAqiError="Unable to reach live Open-Meteo Air Quality API."
        onRetryLiveAqi={onRetryLiveAqi}
        persona="senior"
        onSelectPersona={vi.fn()}
        modifiers={[]}
        onToggleModifier={vi.fn()}
        advisory={null}
        isLoadingAdvisory={false}
        advisoryError="Gemini advisory temporarily unavailable."
        onRetryAdvisory={onRetryAdvisory}
        onToggleRoutine={vi.fn()}
        hacks={INITIAL_INDOOR_HACKS}
        onToggleHack={vi.fn()}
      />
    );

    const retryOpenMeteo = screen.getByRole('button', { name: /Retry Open-Meteo/i });
    const retryVerdict = screen.getByRole('button', { name: /Retry Verdict/i });
    fireEvent.click(retryOpenMeteo);
    fireEvent.click(retryVerdict);
    expect(onRetryLiveAqi).toHaveBeenCalledTimes(1);
    expect(onRetryAdvisory).toHaveBeenCalledTimes(1);
    unmount();

    // 4b. RoomAuditTab Vision API failure state
    mockBrowserImageAndCanvas();
    vi.spyOn(geminiService, 'analyzeRoomPhotoWithGemini').mockRejectedValue(
      new Error('Rate limit reached. Please retry in 15s.')
    );

    render(
      <RoomAuditTab
        city={createLiveCity()}
        addedAuditFixKeys={[]}
        onToggleAddVisionFix={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Vision Scan Interrupted/i);
    });
    expect(screen.getByRole('button', { name: /Retry Vision Scan/i })).toBeInTheDocument();
    cleanup();

    // 4c. TabErrorBoundary catches unexpected render crash without breaking the app
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenSection(): null {
      throw new Error('Simulated chart rendering failure');
    }

    render(
      <TabErrorBoundary sectionName="Today Dashboard">
        <BrokenSection />
      </TabErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/Today Dashboard paused unexpectedly/i);
    expect(screen.getByRole('button', { name: /Reload Today Dashboard/i })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('5. renders Senior-Friendly Voice controls only when Web Speech API is supported', () => {
    const speakMock = vi.fn();
    const cancelMock = vi.fn();

    class MockUtterance {
      text: string;
      lang = 'en-IN';
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal('speechSynthesis', { speak: speakMock, cancel: cancelMock });
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);

    const city = createLiveCity({ name: 'Bhubaneswar', aqi: 72, severity: 'moderate', severityLabel: 'MODERATE' });

    const { unmount } = render(
      <TodayTab
        city={city}
        isLoadingLiveAqi={false}
        liveAqiError={null}
        onRetryLiveAqi={vi.fn()}
        persona="senior"
        onSelectPersona={vi.fn()}
        modifiers={[]}
        onToggleModifier={vi.fn()}
        advisory={{
          heroVerdict: 'Moderate air — morning walks are comfortable.',
          asthmaTip: '',
          gasStoveTip: '',
          routines: [],
        }}
        isLoadingAdvisory={false}
        advisoryError={null}
        onRetryAdvisory={vi.fn()}
        onToggleRoutine={vi.fn()}
        hacks={INITIAL_INDOOR_HACKS}
        onToggleHack={vi.fn()}
      />
    );

    const listenBtn = screen.getByRole('button', {
      name: /Listen to today air quality verdict/i,
    });
    expect(listenBtn).toBeInTheDocument();
    fireEvent.click(listenBtn);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: /Stop reading today air quality verdict/i })
    ).toBeInTheDocument();
    unmount();

    // Copilot voice mic button appears when webkitSpeechRecognition is available
    class MockSpeechRecognition {
      lang = 'en-IN';
      interimResults = true;
      continuous = false;
      onresult = null;
      onerror = null;
      onend = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      writable: true,
      value: MockSpeechRecognition,
    });

    const mockContext: LiveAppContext = {
      activeTab: 'Today',
      telemetry: {
        city: city.name,
        state: city.state,
        aqi: city.aqi,
        severityLabel: city.severityLabel,
        pm25: city.pm25,
        pm10: city.pm10,
        no2: city.no2,
        o3: city.o3,
        safeWindowLabel: city.safeWindowLabel,
        hourlySummary: '6A: 80',
        isLive: true,
      },
      profile: { personaId: 'senior', personaLabel: 'Senior Citizen', riskChips: [] },
      roomAudit: null,
      commute: null,
      activeHabits: [],
    };

    render(
      <FloatingCopilot
        activeTab="today"
        city={city}
        persona="senior"
        personaLabel="Senior Citizen"
        getLiveAppContext={() => mockContext}
        onOpenMapRoute={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /Speak question to AeroPulse/i })
    ).toBeInTheDocument();

    // Clean up custom window property
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('6. isolates uploaded photos, object URL cleanup, and diagnoses strictly per room in RoomAuditTab', async () => {
    mockBrowserImageAndCanvas();

    let blobCounter = 0;
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:room-photo-${++blobCounter}`);
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    vi.spyOn(geminiService, 'analyzeRoomPhotoWithGemini').mockImplementation(async (opts) => ({
      riskLevel: opts.roomType === 'Kitchen' ? 'Severe' : 'High',
      fixPotentialPercent: opts.roomType === "Kids' Bedroom" ? 64 : 48,
      traps: [
        {
          id: 1,
          title: `${opts.roomType} Primary Trap`,
          x: 40,
          y: 50,
          category: 'DIY',
          costBadge: '₹250',
          fixAction: `Fix trap in ${opts.roomType}`,
          whyImpact: `Reduces PM2.5 in ${opts.roomType}.`,
        },
      ],
    }));

    const { unmount } = render(
      <RoomAuditTab
        city={createLiveCity()}
        addedAuditFixKeys={[]}
        onToggleAddVisionFix={vi.fn()}
      />
    );

    await screen.findByText(/Fix trap in Living Room/i);

    // Switch to Kids' Bedroom and upload a photo
    fireEvent.click(screen.getByRole('button', { name: /Kids' Bedroom/i }));
    await screen.findByText(/Fix trap in Kids' Bedroom/i);

    const fileInput = screen.getByLabelText(/Upload photo for Kids' Bedroom/i) as HTMLInputElement;
    const bedroomFile = new File(['bedroom-bytes'], 'bedroom-window.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [bedroomFile] } });
    expect(fileInput.value).toBe('');

    await waitFor(() => {
      expect(screen.getByTestId('active-room-badge')).toHaveTextContent(
        "Kids' Bedroom (Uploaded)"
      );
    });

    const bedroomImg = screen.getByAltText(/Kids' Bedroom \(Uploaded\) indoor air quality/i);
    const firstBedroomBlob = bedroomImg.getAttribute('src');
    expect(firstBedroomBlob).toMatch(/^blob:room-photo-/);

    // Switch to Kitchen -> bedroom photo must NOT leak into Kitchen
    fireEvent.click(screen.getByRole('button', { name: /^Kitchen$/i }));
    await screen.findByText(/Fix trap in Kitchen/i);
    expect(screen.getByTestId('active-room-badge')).toHaveTextContent('Gas Kitchen');
    const kitchenImg = screen.getByRole('img', { name: /indoor air quality vision audit/i });
    expect(kitchenImg.getAttribute('src')).not.toBe(firstBedroomBlob);

    // Switch to Living Room -> bedroom photo must NOT leak into Living Room
    fireEvent.click(screen.getByRole('button', { name: /^Living Room$/i }));
    await screen.findByText(/Fix trap in Living Room/i);
    const livingImg = screen.getByRole('img', { name: /indoor air quality vision audit/i });
    expect(livingImg.getAttribute('src')).not.toBe(firstBedroomBlob);

    // Switch back to Kids' Bedroom -> uploaded photo is still preserved
    fireEvent.click(screen.getByRole('button', { name: /Kids' Bedroom/i }));
    expect(screen.getByTestId('active-room-badge')).toHaveTextContent("Kids' Bedroom (Uploaded)");
    expect(
      screen.getByAltText(/Kids' Bedroom \(Uploaded\) indoor air quality/i).getAttribute('src')
    ).toBe(firstBedroomBlob);

    // Re-upload the same file -> triggers onChange cleanly & revokes previous blob URL
    const reuploadInput = screen.getByLabelText(
      /Upload photo for Kids' Bedroom/i
    ) as HTMLInputElement;
    fireEvent.change(reuploadInput, { target: { files: [bedroomFile] } });

    await waitFor(() => {
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith(firstBedroomBlob);
    });
    const secondBedroomBlob = screen
      .getByAltText(/Kids' Bedroom \(Uploaded\) indoor air quality/i)
      .getAttribute('src');
    expect(secondBedroomBlob).toMatch(/^blob:room-photo-/);
    expect(secondBedroomBlob).not.toBe(firstBedroomBlob);

    // Reset Kids' Bedroom photo -> revokes its second blob URL without affecting other rooms
    fireEvent.click(screen.getByRole('button', { name: /Reset Kids' Bedroom photo/i }));
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith(secondBedroomBlob);
    expect(screen.getByTestId('active-room-badge')).not.toHaveTextContent(/Uploaded/i);

    expect(createObjectUrlSpy).toHaveBeenCalled();
    unmount();
  });

  it('7. keeps FloatingCopilot microphone toggle stable across re-renders and handles speech errors cleanly', () => {
    interface MockSpeechInstance {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onstart: (() => void) | null;
      onresult: ((event: { resultIndex: number; results: { length: number; [k: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } } } }) => void) | null;
      onerror: ((event: { error?: string }) => void) | null;
      onend: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    }

    const instances: MockSpeechInstance[] = [];

    class StableMockSpeechRecognition implements MockSpeechInstance {
      lang = 'en-IN';
      interimResults = true;
      continuous = false;
      onstart: (() => void) | null = null;
      onresult: MockSpeechInstance['onresult'] = null;
      onerror: MockSpeechInstance['onerror'] = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        instances.push(this);
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      writable: true,
      value: StableMockSpeechRecognition,
    });

    const baseCity = createLiveCity({ name: 'Delhi', aqi: 185 });
    const mockContext: LiveAppContext = {
      activeTab: 'Today',
      telemetry: {
        city: baseCity.name,
        state: baseCity.state,
        aqi: baseCity.aqi,
        severityLabel: baseCity.severityLabel,
        pm25: baseCity.pm25,
        pm10: baseCity.pm10,
        no2: baseCity.no2,
        o3: baseCity.o3,
        safeWindowLabel: baseCity.safeWindowLabel,
        hourlySummary: '6A: 240',
        isLive: true,
      },
      profile: { personaId: 'parent', personaLabel: 'Parent', riskChips: [] },
      roomAudit: null,
      commute: null,
      activeHabits: [],
    };

    const { rerender, unmount } = render(
      <FloatingCopilot
        activeTab="today"
        city={baseCity}
        persona="parent"
        personaLabel="Parent"
        getLiveAppContext={() => mockContext}
        onOpenMapRoute={vi.fn()}
      />
    );

    // Click mic to start listening
    const startMicBtn = screen.getByRole('button', { name: /Speak question to AeroPulse/i });
    fireEvent.click(startMicBtn);

    expect(instances).toHaveLength(1);
    const first = instances[0];
    expect(first.start).toHaveBeenCalledTimes(1);
    expect(first.continuous).toBe(true);

    const stopMicBtn = screen.getByRole('button', { name: /Stop voice input/i });
    expect(stopMicBtn).toHaveAttribute('aria-pressed', 'true');

    // Simulate onstart + transcript result -> triggers input re-render without recreating recognition
    act(() => {
      first.onstart?.();
      first.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { isFinal: false, length: 1, 0: { transcript: 'best mask for delhi' } },
        },
      });
    });

    expect(screen.getByDisplayValue('best mask for delhi')).toBeInTheDocument();
    expect(instances).toHaveLength(1);
    expect(first.stop).not.toHaveBeenCalled();

    // Parent prop update re-renders FloatingCopilot -> recognition remains active without flicker
    rerender(
      <FloatingCopilot
        activeTab="today"
        city={createLiveCity({ name: 'Delhi', aqi: 192 })}
        persona="parent"
        personaLabel="Parent"
        getLiveAppContext={() => mockContext}
        onOpenMapRoute={vi.fn()}
      />
    );
    expect(instances).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Stop voice input/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Benign no-speech event does not surface an error banner or kill state
    act(() => {
      first.onerror?.({ error: 'no-speech' });
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Permission error surfaces clear status message and resets listening state cleanly
    act(() => {
      first.onerror?.({ error: 'not-allowed' });
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Microphone permission denied/i);
    expect(screen.getByRole('button', { name: /Speak question to AeroPulse/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Start again, then click mic again to stop cleanly
    fireEvent.click(screen.getByRole('button', { name: /Speak question to AeroPulse/i }));
    expect(instances).toHaveLength(2);
    const second = instances[1];
    expect(second.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Stop voice input/i }));
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Speak question to AeroPulse/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    unmount();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
});

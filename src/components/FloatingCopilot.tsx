import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  MapPin,
  MessageSquare,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { sendCopilotChatMessage } from '../services/gemini';
import {
  AeroTab,
  CityAirProfile,
  CopilotChatItem,
  CopilotMapAction,
  LiveAppContext,
  PersonaId,
} from '../types/aeropulse';
import { sanitizeUserInput } from '../utils/impactCalc';

interface FloatingCopilotProps {
  activeTab: AeroTab;
  city: CityAirProfile;
  persona: PersonaId;
  personaLabel: string;
  getLiveAppContext: () => LiveAppContext;
  onOpenMapRoute: (origin: string, destination: string) => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as WindowWithSpeechRecognition;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

const TAB_STARTER_CHIPS: Record<AeroTab, string[]> = {
  today: [
    'Safe window for outdoor activity?',
    'How to cut indoor PM2.5 right now?',
    'Best low-emission routine today?',
  ],
  'room-audit': [
    'Cheapest way to fix these room traps?',
    'Do I need a HEPA purifier here?',
    'Best indoor plants for this room?',
  ],
  commute: [
    'Is an N95 needed for this route?',
    'Metro vs. carpool impact today?',
    'How can my colony cut smog?',
  ],
};

function getTabPlaceholder(activeTab: AeroTab, cityName: string): string {
  if (activeTab === 'room-audit') {
    return `Ask AeroPulse about your ${cityName} room traps or purifier fixes...`;
  }
  if (activeTab === 'commute') {
    return `Ask AeroPulse about your ${cityName} commute route or colony impact...`;
  }
  return `Ask AeroPulse about ${cityName} air, safe window, or routine...`;
}

function parseInlineMapAction(text: string): {
  cleaned: string;
  action: CopilotMapAction | null;
} {
  const match = text.match(/\{[^{}]*"action"\s*:\s*"OPEN_MAP"[^{}]*\}/);
  if (!match) return { cleaned: text, action: null };
  let action: CopilotMapAction | null = null;
  try {
    const parsed = JSON.parse(match[0]) as {
      action?: string;
      origin?: string;
      destination?: string;
    };
    if (parsed.action === 'OPEN_MAP' && parsed.origin?.trim() && parsed.destination?.trim()) {
      action = {
        action: 'OPEN_MAP',
        origin: parsed.origin.trim(),
        destination: parsed.destination.trim(),
      };
    }
  } catch {
    // ignore malformed inline JSON
  }
  return {
    cleaned: text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim(),
    action,
  };
}

export function FloatingCopilot({
  activeTab,
  city,
  persona,
  personaLabel,
  getLiveAppContext,
  onOpenMapRoute,
}: FloatingCopilotProps) {
  const [messages, setMessages] = useState<CopilotChatItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const prevContextSigRef = useRef<{ cityId: string; persona: PersonaId } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningIntentRef = useRef<boolean>(false);

  const isVoiceSupported = getSpeechRecognitionCtor() !== null;

  // Clean up speech recognition if component unmounts
  useEffect(() => {
    return () => {
      isListeningIntentRef.current = false;
      const active = recognitionRef.current;
      recognitionRef.current = null;
      if (active) {
        try {
          active.abort();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  const stopVoiceInput = () => {
    isListeningIntentRef.current = false;
    setIsListening(false);
    const active = recognitionRef.current;
    if (active) {
      recognitionRef.current = null;
      try {
        active.stop();
      } catch {
        // ignore already stopped
      }
    }
  };

  const toggleVoiceInput = () => {
    if (isListeningIntentRef.current) {
      stopVoiceInput();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceStatus('Voice input is not supported in this browser.');
      return;
    }

    // Abort any leftover recognition instance before starting a fresh session
    if (recognitionRef.current) {
      const stale = recognitionRef.current;
      recognitionRef.current = null;
      try {
        stale.abort();
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      const recognition = new Ctor();
      recognition.lang = 'en-IN';
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        isListeningIntentRef.current = true;
        setIsListening(true);
        setVoiceStatus(null);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (recognitionRef.current !== recognition) return;
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          const item = event.results[i];
          if (item && item[0]?.transcript) {
            transcript += item[0].transcript;
          }
        }
        const cleaned = sanitizeUserInput(transcript, 400);
        if (cleaned) {
          setInput(cleaned);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (recognitionRef.current !== recognition) return;
        const code = event?.error ?? '';

        // Gracefully ignore benign stop / silence events without getting stuck
        if (code === 'aborted') {
          if (!isListeningIntentRef.current) return;
          recognitionRef.current = null;
          isListeningIntentRef.current = false;
          setIsListening(false);
          return;
        }

        if (code === 'no-speech') {
          return;
        }

        recognitionRef.current = null;
        isListeningIntentRef.current = false;
        setIsListening(false);

        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setVoiceStatus('Microphone permission denied — allow mic access to speak.');
        } else if (code === 'audio-capture') {
          setVoiceStatus('No microphone detected on this device.');
        } else if (code === 'network') {
          setVoiceStatus('Voice recognition interrupted by network. Tap mic to retry.');
        } else {
          setVoiceStatus('Voice input paused. Tap the mic to try again.');
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        isListeningIntentRef.current = false;
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      isListeningIntentRef.current = true;
      setIsListening(true);
      setVoiceStatus(null);
      recognition.start();
    } catch {
      recognitionRef.current = null;
      isListeningIntentRef.current = false;
      setIsListening(false);
      setVoiceStatus('Unable to start microphone input. Tap mic to retry.');
    }
  };

  // Close drawer smoothly on Escape key
  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  // Auto-scroll smoothly when messages or loading state update
  useEffect(() => {
    if (!isExpanded || !scrollViewportRef.current) return;
    scrollViewportRef.current.scrollTo({
      top: scrollViewportRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isResponding, chatError, isExpanded]);

  // Live Sync Divider: when City or Persona changes while a chat thread exists, insert a subtle frosted pill
  useEffect(() => {
    const prev = prevContextSigRef.current;
    if (!prev) {
      prevContextSigRef.current = { cityId: city.id, persona };
      return;
    }

    const cityChanged = prev.cityId !== city.id;
    const personaChanged = prev.persona !== persona;
    if (!cityChanged && !personaChanged) return;

    // Wait until live AQI finishes syncing when switching to a new city so the divider shows the real AQI
    if (cityChanged && !city.isLive) return;

    prevContextSigRef.current = { cityId: city.id, persona };

    setMessages((current) => {
      const hasTurns = current.some((m) => m.kind === 'user' || m.kind === 'assistant');
      if (!hasTurns) return current;

      const label = `Context updated • ${city.name} (${city.aqi} AQI) • ${personaLabel}`;
      const last = current[current.length - 1];
      if (last?.kind === 'divider') {
        if (last.label === label) return current;
        return [...current.slice(0, -1), { id: `div-${Date.now()}`, kind: 'divider', label }];
      }
      return [...current, { id: `div-${Date.now()}`, kind: 'divider', label }];
    });
  }, [city.id, city.name, city.aqi, city.isLive, persona, personaLabel]);

  const sendMessage = async (rawText: string, isRetry = false) => {
    const trimmed = sanitizeUserInput(rawText, 500);
    if (!trimmed || isResponding) return;

    setIsExpanded(true);
    setChatError(null);
    setLastFailedPrompt(null);
    if (!isRetry) {
      setInput('');
    }

    // Build real multi-turn conversation history prior to this message
    const history = messages
      .filter((m): m is Extract<CopilotChatItem, { kind: 'user' | 'assistant' }> => m.kind !== 'divider')
      .map((m) =>
        m.kind === 'user'
          ? { role: 'user' as const, text: m.text }
          : {
              role: 'model' as const,
              text: `${m.directAnswer} ${m.steps.join(' ')} Why & Impact: ${m.whyImpact}`,
            }
      );

    // If retrying, avoid duplicating the last user bubble
    if (!isRetry) {
      const userBubble: CopilotChatItem = {
        id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'user',
        text: trimmed,
      };
      setMessages((prev) => [...prev, userBubble]);
    } else if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop();
    }

    // Snapshot latest city/persona signature at send time
    prevContextSigRef.current = { cityId: city.id, persona };

    const liveContext = getLiveAppContext();
    setIsResponding(true);

    try {
      const data = await sendCopilotChatMessage({
        message: trimmed,
        history,
        context: liveContext,
      });

      let resolvedMapAction: CopilotMapAction | null =
        data.mapAction &&
        data.mapAction.action === 'OPEN_MAP' &&
        data.mapAction.origin?.trim() &&
        data.mapAction.destination?.trim()
          ? {
              action: 'OPEN_MAP',
              origin: data.mapAction.origin.trim(),
              destination: data.mapAction.destination.trim(),
            }
          : null;

      const cleanDirect = parseInlineMapAction(data.directAnswer);
      if (!resolvedMapAction && cleanDirect.action) {
        resolvedMapAction = cleanDirect.action;
      }

      const cleanSteps = (Array.isArray(data.steps) ? data.steps : [])
        .map((s) => {
          const parsedStep = parseInlineMapAction(s);
          if (!resolvedMapAction && parsedStep.action) {
            resolvedMapAction = parsedStep.action;
          }
          return parsedStep.cleaned;
        })
        .filter(Boolean);

      const cleanWhy = parseInlineMapAction(data.whyImpact || '');
      if (!resolvedMapAction && cleanWhy.action) {
        resolvedMapAction = cleanWhy.action;
      }

      const assistantBubble: CopilotChatItem = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'assistant',
        directAnswer: cleanDirect.cleaned,
        steps: cleanSteps,
        whyImpact: cleanWhy.cleaned,
        mapAction: resolvedMapAction,
        modelUsed: data.modelUsed,
      };
      setMessages((prev) => [...prev, assistantBubble]);
    } catch (err) {
      setChatError(
        err instanceof Error
          ? err.message
          : 'Network error reaching AeroPulse Gemini copilot. Tap retry.'
      );
      setLastFailedPrompt(trimmed);
    } finally {
      setIsResponding(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isListeningIntentRef.current) stopVoiceInput();
    setVoiceStatus(null);
    void sendMessage(input);
  };

  const handleClearChat = () => {
    setMessages([]);
    setChatError(null);
    setLastFailedPrompt(null);
    setIsExpanded(false);
  };

  const starterChips = TAB_STARTER_CHIPS[activeTab];
  const turnCount = messages.filter((m) => m.kind === 'user').length;
  const syncBadgeText = city.isLive
    ? `Synced: ${city.name} • ${city.aqi} AQI • ${personaLabel}`
    : `Syncing: ${city.name} • ${personaLabel}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl">
        {/* Expandable Frosted-Glass Multi-Turn Chat Drawer */}
        <AnimatePresence>
          {isExpanded && (
            <motion.section
              key="aeropulse-copilot-drawer"
              aria-label="Ask AeroPulse conversation"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="mb-3 overflow-hidden rounded-3xl border border-white/90 bg-white/85 shadow-[0_24px_54px_-14px_rgba(15,23,42,0.18),0_0_0_1px_rgba(226,232,240,0.75)] backdrop-blur-2xl"
            >
              {/* Drawer Header: Live Sync Context Badge + Minimize / Clear */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 bg-white/60 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#0F172A] text-white shadow-xs">
                    <Sparkles className="h-3.5 w-3.5 text-[#34C759]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-display text-[13px] font-bold tracking-[-0.01em] text-[#0F172A]">
                        Ask AeroPulse
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#34C759]/12 px-2 py-0.5 text-[10.5px] font-bold text-[#1E8E3E] tabular-nums-strict truncate">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34C759]" />
                        <span className="truncate">{syncBadgeText}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearChat}
                      title="Clear conversation"
                      aria-label="Clear conversation"
                      className="apple-press inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold text-[#64748B] hover:bg-slate-200/60 hover:text-[#0F172A]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">Clear</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsExpanded(false)}
                    title="Minimize chat"
                    aria-label="Minimize chat drawer"
                    className="apple-press inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100/90 text-[#475569] hover:bg-slate-200/80 hover:text-[#0F172A]"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Scrollable Multi-Turn Conversation Body */}
              <div
                ref={scrollViewportRef}
                className="max-h-[340px] space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
              >
                {messages.length === 0 && !isResponding && !chatError && (
                  <div className="py-4 text-center text-[12.5px] font-medium text-[#64748B]">
                    Tap a quick prompt below or ask anything about live {city.name} air quality,
                    room traps, or commute exposure.
                  </div>
                )}

                {messages.map((item) => {
                  if (item.kind === 'divider') {
                    return (
                      <div key={item.id} className="flex justify-center py-1">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#64748B] shadow-2xs backdrop-blur-md tabular-nums-strict">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#00C7BE]" aria-hidden="true" />
                          {item.label}
                        </span>
                      </div>
                    );
                  }

                  if (item.kind === 'user') {
                    return (
                      <div key={item.id} className="flex justify-end">
                        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[#0F172A] px-3.5 py-2.5 text-[13px] font-medium leading-snug text-white shadow-xs">
                          {item.text}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="flex justify-start"
                    >
                      <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-md border border-slate-200/80 bg-white/95 px-4 py-3 shadow-2xs">
                        {/* Bold 1-Line Direct Answer */}
                        <p className="font-display text-[14px] font-extrabold leading-snug text-[#0F172A]">
                          {item.directAnswer}
                        </p>

                        {/* 1-2 Actionable Steps */}
                        {item.steps.length > 0 && (
                          <ul className="space-y-1 text-[12.5px] font-medium leading-snug text-[#334155]">
                            {item.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span
                                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#34C759]"
                                  aria-hidden="true"
                                />
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Brief Why & Impact Line */}
                        {item.whyImpact && (
                          <div className="flex items-start gap-1.5 rounded-xl bg-[#34C759]/8 px-2.5 py-1.5 text-[11.5px] font-semibold leading-snug text-[#1E8E3E]">
                            <span className="shrink-0 font-extrabold">Why &amp; Impact:</span>
                            <span className="text-[#166534]">{item.whyImpact}</span>
                          </div>
                        )}

                        {/* Interactive Chat-to-Map Frosted Emerald Action Button */}
                        {item.mapAction && item.mapAction.action === 'OPEN_MAP' && (
                          <div className="pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setIsExpanded(false);
                                onOpenMapRoute(
                                  item.mapAction!.origin,
                                  item.mapAction!.destination
                                );
                              }}
                              className="apple-press group inline-flex w-full items-center justify-between gap-2.5 rounded-2xl border border-[#34C759]/35 bg-[#34C759]/14 px-3.5 py-2.5 text-left text-[#15803D] shadow-2xs backdrop-blur-md transition-colors hover:border-[#34C759]/50 hover:bg-[#34C759]/22"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white shadow-2xs">
                                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-display text-[12.5px] font-extrabold tracking-[-0.01em] text-[#14532D]">
                                    Plot Route on Map
                                  </span>
                                  <span className="block truncate text-[11px] font-semibold text-[#1E8E3E]">
                                    {item.mapAction.origin} → {item.mapAction.destination}
                                  </span>
                                </span>
                              </span>
                              <ArrowRight
                                className="h-4 w-4 shrink-0 text-[#1E8E3E] transition-transform duration-200 group-hover:translate-x-0.5"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}

                {/* Smooth Typing Shimmer Indicator */}
                {isResponding && (
                  <div className="flex justify-start">
                    <div className="w-64 space-y-2 rounded-2xl rounded-bl-md border border-slate-200/80 bg-white/90 px-4 py-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#008A84]">
                        <Sparkles className="h-3 w-3 animate-pulse" aria-hidden="true" />
                        <span>Syncing live {city.name} context…</span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-200/85" />
                        <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-slate-200/65" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Clean Error Notice with Retry */}
                {chatError && (
                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl border border-[#FF3B30]/25 bg-[#FF3B30]/[0.06] px-3.5 py-2.5 text-[12.5px]">
                      <div className="flex items-center gap-1.5 font-bold text-[#D6281F]">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>AeroPulse Copilot</span>
                      </div>
                      <p className="mt-1 font-medium text-[#334155]">{chatError}</p>
                      {lastFailedPrompt && (
                        <button
                          type="button"
                          onClick={() => void sendMessage(lastFailedPrompt, true)}
                          className="apple-press mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#0F172A] px-3 py-1 text-[11.5px] font-semibold text-white"
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden="true" />
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Compact Floating Bottom Bar */}
        <div className="glass-floating rounded-3xl p-2.5 sm:p-3">
          {/* Dynamic Tab-Aware Starter Chips + Resume Thread Pill */}
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {starterChips.map((chip) => (
                <button
                  key={`${activeTab}-${chip}`}
                  type="button"
                  disabled={isResponding || !city.isLive}
                  onClick={() => void sendMessage(chip)}
                  className="apple-press rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-[11.5px] font-semibold text-[#334155] hover:border-slate-300 hover:bg-slate-50 whitespace-nowrap disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            {!isExpanded && turnCount > 0 && (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="apple-press inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0F172A] px-2.5 py-1 text-[11px] font-bold text-white shadow-xs whitespace-nowrap"
              >
                <MessageSquare className="h-3 w-3 text-[#34C759]" aria-hidden="true" />
                <span>{turnCount}</span>
              </button>
            )}
          </div>

          {/* Frosted Chat Input */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div
              className={`flex h-10 flex-1 items-center gap-2 rounded-2xl bg-slate-100/85 pl-3.5 pr-1.5 ring-1 transition-colors focus-within:bg-white ${
                isListening
                  ? 'ring-[#FF3B30]/60 bg-rose-50/40'
                  : 'ring-slate-200/70 focus-within:ring-[#34C759]'
              }`}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-[#00C7BE]" aria-hidden="true" />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  if (messages.length > 0) setIsExpanded(true);
                }}
                disabled={isResponding}
                placeholder={
                  isListening
                    ? 'Listening… speak your question clearly'
                    : getTabPlaceholder(activeTab, city.name)
                }
                className="w-full bg-transparent text-[13px] font-medium text-[#0F172A] placeholder:text-[#64748B] focus:outline-none disabled:opacity-60"
              />
              {isVoiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={isResponding}
                  aria-pressed={isListening}
                  aria-label={isListening ? 'Stop voice input' : 'Speak question to AeroPulse'}
                  title={isListening ? 'Stop listening' : 'Speak your question'}
                  className={`apple-press relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-45 ${
                    isListening
                      ? 'bg-[#FF3B30] text-white shadow-[0_0_0_3px_rgba(255,59,48,0.22)]'
                      : 'text-[#475569] hover:bg-slate-200/80 hover:text-[#0F172A]'
                  }`}
                >
                  {isListening && (
                    <span
                      className="animate-ar-pulse pointer-events-none absolute inset-0 rounded-full bg-[#FF3B30]"
                      aria-hidden="true"
                    />
                  )}
                  {isListening ? (
                    <Square className="relative z-10 h-2.5 w-2.5 fill-current" aria-hidden="true" />
                  ) : (
                    <Mic className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isResponding || !input.trim() || !city.isLive}
              aria-label="Send message to AeroPulse"
              className="apple-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#0F172A] text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>

          {voiceStatus && (
            <p
              role="status"
              aria-live="polite"
              className="mt-1.5 flex items-center gap-1.5 px-2 text-[11.5px] font-medium text-[#D6281F]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{voiceStatus}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

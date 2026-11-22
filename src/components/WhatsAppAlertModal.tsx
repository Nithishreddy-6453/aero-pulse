import { useEffect, useState } from 'react';
import { Check, Copy, MessageCircle, ShieldAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CityAirProfile } from '../types/aeropulse';

export type WhatsAppLanguage = 'en' | 'hi';

interface WhatsAppAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  city: CityAirProfile;
  language: WhatsAppLanguage;
  onChangeLanguage: (lang: WhatsAppLanguage) => void;
  colonyCo2WeeklyKg: number;
  carsOffRoad: number;
  onShowToast: (message: string) => void;
}

const HINDI_CITY_NAMES: Record<string, string> = {
  'new delhi': 'नई दिल्ली',
  delhi: 'दिल्ली',
  bhubaneswar: 'भुवनेश्वर',
  mumbai: 'मुंबई',
  bengaluru: 'बेंगलुरु',
  bangalore: 'बेंगलुरु',
  kolkata: 'कोलकाता',
  lucknow: 'लखनऊ',
  hyderabad: 'हैदराबाद',
  chennai: 'चेन्नई',
  pune: 'पुणे',
  jaipur: 'जयपुर',
  ahmedabad: 'अहमदाबाद',
  patna: 'पटना',
  chandigarh: 'चंडीगढ़',
  gurugram: 'गुरुग्राम',
  noida: 'नोएडा',
  cuttack: 'कटक',
  jatani: 'जटनी',
};

function toHindiCity(name: string): string {
  return HINDI_CITY_NAMES[name.toLowerCase().trim()] ?? name;
}

function toHindiSeverity(aqi: number): string {
  if (aqi <= 50) return 'अच्छा';
  if (aqi <= 100) return 'मध्यम';
  if (aqi <= 200) return 'खराब';
  if (aqi < 300) return 'बहुत खराब';
  return 'गंभीर';
}

function toHindiTimeSlot(part: string): string {
  const m = part.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return part.trim();
  const hour = Number(m[1]);
  const mins = m[2] ? `:${m[2]}` : '';
  const period = m[3].toUpperCase();
  if (period === 'AM') {
    return `सुबह ${hour}${mins} बजे`;
  }
  if (hour === 12 || hour <= 3) {
    return `दोपहर ${hour}${mins} बजे`;
  }
  if (hour <= 7) {
    return `शाम ${hour}${mins} बजे`;
  }
  return `रात ${hour}${mins} बजे`;
}

function toHindiSafeWindow(windowLabel: string): string {
  const parts = windowLabel.split(/\s*[–-]\s*/);
  if (parts.length === 2) {
    return `${toHindiTimeSlot(parts[0])} – ${toHindiTimeSlot(parts[1])}`;
  }
  return windowLabel;
}

export function buildWhatsAppBroadcastMessage(params: {
  city: CityAirProfile;
  language: WhatsAppLanguage;
  colonyCo2WeeklyKg: number;
  carsOffRoad: number;
}): string {
  const { city, language, colonyCo2WeeklyKg, carsOffRoad } = params;
  const isSevere = city.aqi >= 300;
  const isPoor = city.aqi >= 101 && city.aqi < 300;

  if (language === 'hi') {
    const hiCity = toHindiCity(city.name);
    const hiSeverity = toHindiSeverity(city.aqi);
    const hiWindow = toHindiSafeWindow(city.safeWindowLabel);

    const header = isSevere
      ? `🚨 AeroPulse गंभीर स्मॉग अलर्ट — ${hiCity} (${city.colonyName})`
      : `🌿 AeroPulse वायु गुणवत्ता सूचना — ${hiCity} (${city.colonyName})`;

    const precautions = isSevere
      ? [
          `1. खिड़कियाँ व बालकनी की दरारें बंद रखें और कमरे में गीला पोंछा लगाएँ।`,
          `2. बाहर निकलते समय N95 मास्क पहनें और बच्चों व वरिष्ठ नागरिकों की बाहरी गतिविधि रोकें।`,
        ]
      : isPoor
        ? [
            `1. ट्रैफ़िक या शाम के धुएँ में N95 मास्क पहनें और खाना बनाते समय चिमनी/एग्जॉस्ट चलाएँ।`,
            `2. सुबह-शाम की जगह ${hiWindow} के बीच ही वॉक या ज़रूरी काम निपटाएँ।`,
          ]
        : [
            `1. घर में ताज़ा हवा के लिए ${hiWindow} के बीच खिड़कियाँ खोलकर वेंटिलेशन करें।`,
            `2. कॉलोनी में सूखे पत्ते न जलाएँ और शाम के काम एक ही ट्रिप में निपटाएँ।`,
          ];

    return [
      header,
      `• लाइव AQI: ${city.aqi} (${hiSeverity}) • PM2.5: ${city.pm25} μg/m³`,
      `• सुरक्षित बाहरी समय: ${hiWindow}`,
      `• मुख्य सावधानियाँ:`,
      ...precautions.map((line) => `  ${line}`),
      `• कॉलोनी प्रभाव: 500 घरों के स्वच्छ कदम से हर सप्ताह ${colonyCo2WeeklyKg} kg CO₂ बचेगा (~${carsOffRoad} कारें सड़क से हटने के बराबर)।`,
    ].join('\n');
  }

  // English version
  const header = isSevere
    ? `🚨 AeroPulse SEVERE SMOG ALERT — ${city.name} (${city.colonyName})`
    : `🌿 AeroPulse ${city.name} Air Alert (${city.colonyName})`;

  const precautions = isSevere
    ? [
        `1. Seal balcony & window gaps, run purifier on Turbo, and wet-mop floors.`,
        `2. Wear N95 masks outdoors and cancel outdoor play for kids & seniors.`,
      ]
    : isPoor
      ? [
          `1. Use N95 masks in traffic corridors and run kitchen exhaust before cooking.`,
          `2. Schedule walks and errands during today's cleaner window (${city.safeWindowLabel}).`,
        ]
      : [
          `1. Cross-ventilate rooms during today's cleanest window (${city.safeWindowLabel}).`,
          `2. Bundle evening errands into one trip and avoid colony leaf burning.`,
        ];

  return [
    header,
    `• Live AQI: ${city.aqi} (${city.severityLabel}) • PM2.5: ${city.pm25} μg/m³`,
    `• Safe Outdoor Window: ${city.safeWindowLabel}`,
    `• Top 2 Precautions:`,
    ...precautions.map((line) => `  ${line}`),
    `• Colony Impact: 500 homes adopting clean swaps save ${colonyCo2WeeklyKg} kg CO₂/wk (~${carsOffRoad} cars off the road).`,
  ].join('\n');
}

export function WhatsAppAlertModal({
  isOpen,
  onClose,
  city,
  language,
  onChangeLanguage,
  colonyCo2WeeklyKg,
  carsOffRoad,
  onShowToast,
}: WhatsAppAlertModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const formattedMessage = buildWhatsAppBroadcastMessage({
    city,
    language,
    colonyCo2WeeklyKg,
    carsOffRoad,
  });

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formattedMessage);
      }
    } catch {
      // Clipboard fallback
    }
    setCopied(true);
    onShowToast(
      language === 'hi'
        ? `हिंदी WhatsApp अलर्ट कॉपी हो गया (${city.colonyName})`
        : `WhatsApp alert copied for ${city.colonyName}`
    );
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="whatsapp-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="whatsapp-modal-title"
        >
          <motion.div
            key="whatsapp-modal-card"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/90 bg-white/90 shadow-[0_28px_64px_-16px_rgba(15,23,42,0.28),0_0_0_1px_rgba(226,232,240,0.8)] backdrop-blur-2xl"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/60 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white shadow-xs ${
                    city.aqi >= 300 ? 'bg-[#FF3B30]' : 'bg-[#34C759]'
                  }`}
                >
                  {city.aqi >= 300 ? (
                    <ShieldAlert className="h-4.5 w-4.5" aria-hidden="true" />
                  ) : (
                    <MessageCircle className="h-4.5 w-4.5" aria-hidden="true" />
                  )}
                </span>
                <div>
                  <h2
                    id="whatsapp-modal-title"
                    className="font-display text-[16px] font-extrabold tracking-[-0.015em] text-[#0F172A]"
                  >
                    WhatsApp Colony &amp; Family Alert
                  </h2>
                  <p className="text-[11.5px] font-semibold text-[#64748B] tabular-nums-strict">
                    {city.name} · {city.aqi} AQI · Ready for RWA &amp; family groups
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close WhatsApp alert modal"
                className="apple-press inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[#475569] hover:bg-slate-200 hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Body: EN | हिंदी Apple Segmented Control + Live Broadcast Preview */}
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] font-bold uppercase tracking-[0.05em] text-[#64748B]">
                  Broadcast Language
                </span>

                <div
                  role="tablist"
                  aria-label="WhatsApp alert language"
                  className="inline-flex items-center rounded-full bg-slate-200/70 p-1"
                >
                  {(
                    [
                      { id: 'en', label: 'English' },
                      { id: 'hi', label: 'हिंदी' },
                    ] as const
                  ).map((opt) => {
                    const active = language === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChangeLanguage(opt.id)}
                        className={`apple-press relative rounded-full px-4 py-1 text-[12px] font-bold transition-colors ${
                          active ? 'text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="whatsappModalLangPill"
                            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                            className="absolute inset-0 rounded-full bg-white shadow-xs"
                          />
                        )}
                        <span className="relative z-10">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* WhatsApp Message Preview Bubble */}
              <div className="rounded-2xl border border-[#34C759]/25 bg-gradient-to-br from-[#34C759]/[0.07] via-white to-slate-50/90 p-4 shadow-inner">
                <pre className="whitespace-pre-wrap font-sans text-[13px] font-medium leading-relaxed text-[#0F172A] tabular-nums-strict">
                  {formattedMessage}
                </pre>
              </div>

              {/* 1-Click Copy CTA */}
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="apple-press inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 font-display text-[14px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(52,199,89,0.6)] hover:bg-[#2DB84F]"
              >
                {copied ? (
                  <>
                    <Check className="h-4.5 w-4.5 stroke-[2.6]" aria-hidden="true" />
                    <span>
                      {language === 'hi'
                        ? `कॉपी हो गया — ${city.colonyName}`
                        : `Copied Alert for ${city.colonyName}`}
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {language === 'hi'
                        ? 'हिंदी WhatsApp संदेश कॉपी करें'
                        : 'Copy WhatsApp Broadcast'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useMemo, useState } from 'react';
import { Check, Copy, Maximize2 } from 'lucide-react';
import { motion } from 'motion/react';
import { CityAirProfile } from '../../types/aeropulse';
import { AnimatedNumber } from '../AnimatedNumber';
import { buildWhatsAppBroadcastMessage, WhatsAppLanguage } from '../WhatsAppAlertModal';

export interface ColonyRippleCardProps {
  city: CityAirProfile;
  colonyCo2WeeklyKg: number;
  carsOffRoad: number;
  whatsappLang: WhatsAppLanguage;
  onChangeWhatsappLang: (lang: WhatsAppLanguage) => void;
  onOpenWhatsappModal: () => void;
  onShowToast: (message: string) => void;
}

export function ColonyRippleCard({
  city,
  colonyCo2WeeklyKg,
  carsOffRoad,
  whatsappLang,
  onChangeWhatsappLang,
  onOpenWhatsappModal,
  onShowToast,
}: ColonyRippleCardProps) {
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);

  const whatsappPreviewMessage = useMemo(
    () =>
      buildWhatsAppBroadcastMessage({
        city,
        language: whatsappLang,
        colonyCo2WeeklyKg,
        carsOffRoad,
      }),
    [city, whatsappLang, colonyCo2WeeklyKg, carsOffRoad]
  );

  const handleCopyWhatsApp = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(whatsappPreviewMessage);
      }
    } catch {
      // Clipboard fallback
    }

    setCopiedWhatsApp(true);
    onShowToast(
      whatsappLang === 'hi'
        ? `हिंदी WhatsApp अलर्ट कॉपी हो गया (${city.colonyName})`
        : `WhatsApp alert copied for ${city.colonyName} RWA`
    );
    window.setTimeout(() => setCopiedWhatsApp(false), 2200);
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-2xl bg-slate-100/90 px-4 py-2.5 text-center text-[12px] font-bold text-[#0F172A] ring-1 ring-slate-200/80">
        Colony Ripple: Equivalent to taking{' '}
        <span className="text-[#15803D]">
          <AnimatedNumber value={carsOffRoad} /> cars
        </span>{' '}
        off the road
      </div>

      {/* Compact Frosted WhatsApp Colony / RWA Broadcast Preview with EN | हिंदी Toggle */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-3.5 shadow-2xs backdrop-blur-xl">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Colony alert language"
            className="inline-flex items-center rounded-full bg-slate-200/70 p-0.5"
          >
            {(
              [
                { id: 'en', label: 'English' },
                { id: 'hi', label: 'हिंदी' },
              ] as const
            ).map((opt) => {
              const active = whatsappLang === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeWhatsappLang(opt.id)}
                  className={`apple-press relative rounded-full px-3 py-1 text-[11.5px] font-bold transition-colors ${
                    active ? 'text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="commuteWhatsappLangPill"
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
            onClick={onOpenWhatsappModal}
            className="apple-press inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#334155] hover:bg-slate-200/80 hover:text-[#0F172A]"
          >
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
            <span>Full Preview</span>
          </button>
        </div>

        <div className="mb-3 max-h-28 overflow-y-auto rounded-xl border border-[#34C759]/20 bg-[#34C759]/[0.05] px-3 py-2">
          <pre className="whitespace-pre-wrap font-sans text-[11.5px] font-medium leading-relaxed text-[#1E293B] tabular-nums-strict">
            {whatsappPreviewMessage}
          </pre>
        </div>

        <button
          type="button"
          onClick={() => void handleCopyWhatsApp()}
          className="apple-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 font-display text-[13.5px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(52,199,89,0.6)] hover:bg-[#2DB84F]"
        >
          {copiedWhatsApp ? (
            <>
              <Check className="h-4.5 w-4.5 stroke-[2.6]" aria-hidden="true" />
              {whatsappLang === 'hi'
                ? `कॉपी हो गया — ${city.colonyName}`
                : `Copied Alert for ${city.colonyName}`}
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {whatsappLang === 'hi'
                ? 'हिंदी WhatsApp अलर्ट कॉपी करें'
                : 'Copy WhatsApp Alert for Colony / RWA'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

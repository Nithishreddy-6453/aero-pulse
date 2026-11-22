interface CircularToggleProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}

export function CircularToggle({
  checked,
  onChange,
  ariaLabel,
  size = 'md',
}: CircularToggleProps) {
  const dims = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const iconDims = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`apple-press relative inline-flex shrink-0 items-center justify-center rounded-full border-2 transition-colors ${dims} ${
        checked
          ? 'border-[#34C759] bg-[#34C759] text-white shadow-[0_2px_8px_rgba(52,199,89,0.35)]'
          : 'border-slate-300 bg-white/90 text-transparent hover:border-[#34C759]/70'
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={`${iconDims} overflow-visible`}
        aria-hidden="true"
      >
        <path
          d="M3.2 8.4L6.5 11.6L12.8 4.6"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 18,
            strokeDashoffset: checked ? 0 : 18,
            transition: 'stroke-dashoffset 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>
    </button>
  );
}

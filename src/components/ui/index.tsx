import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Icon } from './Icon.tsx';

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Click-outside + Escape handling for popovers and menus. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  block?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgba(0,0,0,.18)] border border-transparent',
  secondary:
    'bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-surface-2 hover:text-ink',
  danger: 'bg-bad-soft text-bad border border-transparent hover:brightness-95',
  soft: 'bg-accent-soft text-accent-ink border border-transparent hover:brightness-95',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8.5 px-3 text-[13px]',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="spin inline-block size-3.5 rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 13 : 15} />
      ) : null}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 13 : 15} />}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  active,
  size = 28,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; active?: boolean; size?: number }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{ width: size, height: size }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150',
        active ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  icon,
  dense,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: string;
  dense?: boolean;
}) {
  return (
    <section className={cx('card overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-start gap-2">
            {icon && (
              <span className="mt-0.5 text-accent">
                <Icon name={icon} size={15} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="truncate text-[13.5px] font-semibold text-ink">{title}</h3>}
              {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cx(dense ? 'p-0' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-lg border border-line bg-surface-2/60', className)}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
            {icon && <Icon name={icon} size={13} />}
            {title}
          </div>
          {actions}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Form controls
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  inline,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  inline?: boolean;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx(inline ? 'flex items-center justify-between gap-3' : 'space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[11.5px] font-medium tracking-wide text-ink-muted">
          {label}
        </label>
      )}
      <div className={inline ? 'shrink-0' : ''}>{children}</div>
      {hint && <p className="text-[11px] leading-snug text-ink-faint">{hint}</p>}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-50';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL_BASE, 'h-8', className)} {...rest} />;
}

export function TextArea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL_BASE, 'py-2 leading-relaxed', className)} {...rest} />;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setDraft(String(v));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(draft);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx(CONTROL_BASE, 'h-8 tnum', className)}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  options,
  className,
  placeholder,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        className={cx(CONTROL_BASE, 'h-8 cursor-pointer appearance-none pr-7', className)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={13}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-start gap-2 select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cx(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-all duration-150',
          checked ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40',
        )}
      >
        {checked && <Icon name="check" size={11} weight={2.6} />}
      </span>
      {label && (
        <span className="min-w-0">
          <span className="block text-[12.5px] leading-tight text-ink">{label}</span>
          {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3',
      )}
    >
      <span
        className={cx(
          'absolute size-3.5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: string;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className={cx(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-all duration-150',
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
            value === o.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.icon && <Icon name={o.icon} size={size === 'sm' ? 12 : 13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A checkbox list with search — used for column pickers throughout the app. */
export function CheckList({
  items,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  searchable,
  maxHeight = 220,
  emptyLabel,
  labels,
}: {
  items: { value: string; label: string; hint?: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  searchable?: boolean;
  maxHeight?: number;
  emptyLabel?: string;
  labels?: { search?: string; all?: string; clear?: string };
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () => (q ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : items),
    [items, q],
  );
  return (
    <div className="rounded-lg border border-line bg-surface">
      {(searchable || onSelectAll) && (
        <div className="flex items-center gap-1.5 border-b border-line p-1.5">
          {searchable && (
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={labels?.search ?? 'Search…'}
                className="h-6.5 w-full rounded border border-transparent bg-surface-2 pl-6.5 pr-2 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none"
              />
            </div>
          )}
          {onSelectAll && (
            <button
              type="button"
              onClick={onSelectAll}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              {labels?.all ?? 'All'}
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              {labels?.clear ?? 'Clear'}
            </button>
          )}
        </div>
      )}
      <div className="scroll-thin overflow-y-auto p-1" style={{ maxHeight }}>
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-ink-faint">{emptyLabel ?? '—'}</p>
        ) : (
          filtered.map((item) => (
            <label
              key={item.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={selected.includes(item.value)}
                onChange={() => onToggle(item.value)}
              />
              <span
                className={cx(
                  'grid size-3.5 shrink-0 place-items-center rounded border transition-colors',
                  selected.includes(item.value)
                    ? 'border-accent bg-accent text-white'
                    : 'border-line-strong bg-surface',
                )}
              >
                {selected.includes(item.value) && <Icon name="check" size={10} weight={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.label}</span>
              {item.hint && <span className="shrink-0 text-[10.5px] text-ink-faint">{item.hint}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
  mono,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';
  icon?: string;
  className?: string;
  mono?: boolean;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-3 text-ink-soft',
    accent: 'bg-accent-soft text-accent-ink',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    info: 'bg-info-soft text-info',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        mono && 'font-mono',
        tones[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  actions,
  className,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good' | 'accent';
  icon?: string;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: { bg: 'bg-info-soft', fg: 'text-info', icon: 'info' },
    warn: { bg: 'bg-warn-soft', fg: 'text-warn', icon: 'alert' },
    bad: { bg: 'bg-bad-soft', fg: 'text-bad', icon: 'alert' },
    good: { bg: 'bg-good-soft', fg: 'text-good', icon: 'check' },
    accent: { bg: 'bg-accent-soft', fg: 'text-accent-ink', icon: 'bulb' },
  }[tone];
  return (
    <div className={cx('flex items-start gap-2.5 rounded-lg p-3', tones.bg, className)}>
      <span className={cx('mt-px shrink-0', tones.fg)}>
        <Icon name={icon ?? tones.icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className={cx('text-[12.5px] font-semibold', tones.fg)}>{title}</p>}
        {children && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{children}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon = 'sparkle',
  title,
  hint,
  action,
  compact,
}: {
  icon?: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 py-6' : 'gap-2 py-14')}>
      <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-ink-faint">
        <Icon name={icon} size={18} />
      </span>
      <p className="text-[13px] font-medium text-ink-soft">{title}</p>
      {hint && <p className="max-w-[380px] text-[12px] leading-relaxed text-ink-faint">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('shimmer rounded-md', className)} style={style} />;
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="spin inline-block rounded-full border-2 border-line-strong border-t-accent"
      style={{ width: size, height: size }}
    />
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: 'accent' | 'good' | 'warn' | 'bad';
  className?: string;
}) {
  const tones = { accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' };
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className={cx('h-full rounded-full transition-all duration-500', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  onClick?: () => void;
}) {
  const toneColor =
    tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent-ink' : 'text-ink';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cx(
        'group flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-left transition-colors',
        onClick && 'hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-muted">
        {icon && <Icon name={icon} size={12} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cx('tnum text-[19px] font-semibold leading-tight tracking-tight', toneColor)}>{value}</div>
      {hint && <div className="text-[11px] leading-snug text-ink-faint">{hint}</div>}
    </Comp>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-ink-muted">
      {children}
    </kbd>
  );
}

export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cx('rounded bg-surface-3 px-1 py-0.5 font-mono text-[11.5px] text-ink-soft', className)}>
      {children}
    </code>
  );
}

export function Tag({
  children,
  tone = 'neutral',
  title,
  onRemove,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
  title?: string;
  onRemove?: () => void;
}) {
  const tones = {
    neutral: 'bg-surface-3 text-ink-soft border-line',
    accent: 'bg-accent-soft text-accent-ink border-transparent',
    good: 'bg-good-soft text-good border-transparent',
    warn: 'bg-warn-soft text-warn border-transparent',
    bad: 'bg-bad-soft text-bad border-transparent',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="opacity-60 hover:opacity-100" aria-label="remove">
          <Icon name="x" size={10} weight={2.4} />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  closeLabel = 'Close',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="pop-in relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-pop"
        style={{ maxWidth: width }}
      >
        {title && (
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            <IconButton icon="x" label={closeLabel} onClick={onClose} />
          </header>
        )}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = 'start',
  width,
  className,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: number;
  className?: string;
}) {
  const ref = useDismiss(open, onClose);
  const [flipUp, setFlipUp] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !innerRef.current) return;
    const rect = innerRef.current.getBoundingClientRect();
    setFlipUp(rect.bottom > window.innerHeight - 8 && rect.top > rect.height);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger}
      {open && (
        <div
          ref={innerRef}
          className={cx(
            'pop-in absolute z-40 rounded-lg border border-line bg-elevated p-1.5 shadow-pop',
            align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2',
            flipUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
          style={width ? { width } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  active,
  disabled,
  shortcut,
}: {
  icon?: string;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        disabled && 'cursor-not-allowed opacity-40',
        danger ? 'text-bad hover:bg-bad-soft' : active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-surface-2',
      )}
    >
      {icon && <Icon name={icon} size={13} className="shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{shortcut}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'good' | 'bad' | 'warn';
  detail?: string;
}

interface ToastApi {
  show: (message: string, opts?: { tone?: Toast['tone']; detail?: string }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const show = useCallback((message: string, opts?: { tone?: Toast['tone']; detail?: string }) => {
    seq.current += 1;
    const id = seq.current;
    setItems((prev) => [...prev.slice(-3), { id, message, tone: opts?.tone ?? 'info', detail: opts?.detail }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'rise-in pointer-events-auto flex max-w-[440px] items-start gap-2 rounded-lg border px-3 py-2 shadow-pop backdrop-blur',
              t.tone === 'good'
                ? 'border-good/30 bg-good-soft'
                : t.tone === 'bad'
                  ? 'border-bad/30 bg-bad-soft'
                  : t.tone === 'warn'
                    ? 'border-warn/30 bg-warn-soft'
                    : 'border-line bg-elevated',
            )}
          >
            <Icon
              name={t.tone === 'good' ? 'check' : t.tone === 'info' ? 'info' : 'alert'}
              size={14}
              className={cx(
                'mt-0.5 shrink-0',
                t.tone === 'good' ? 'text-good' : t.tone === 'bad' ? 'text-bad' : t.tone === 'warn' ? 'text-warn' : 'text-accent',
              )}
            />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink">{t.message}</p>
              {t.detail && <p className="mt-0.5 text-[11.5px] text-ink-muted">{t.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? { show: () => {} };
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-ink shadow-pop group-hover/tt:block"
      >
        {label}
      </span>
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-line', className)} />;
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  failedLabel,
  size = 'sm',
  variant = 'ghost',
}: {
  text: string;
  label: string;
  copiedLabel: string;
  /** Shown when the clipboard is unavailable; defaults to the shared copy. */
  failedLabel?: string;
  size?: 'sm' | 'md';
  variant?: ButtonVariant;
}) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button
      size={size}
      variant={variant}
      icon={done ? 'check' : 'copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          toast.show(failedLabel ?? 'Copy failed', { tone: 'warn' });
        }
      }}
    >
      {done ? copiedLabel : label}
    </Button>
  );
}

/** Deterministic id helper for list keys inside forms. */
export function useStableId(prefix: string): string {
  const id = useId();
  return `${prefix}-${id}`;
}

import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/index.tsx';
import type { MessageKey } from '../../i18n/index.tsx';
import { cx } from '../ui/index.tsx';

/** Consistent page chrome: title, subtitle, toolbar, then content. */
export function ViewHeader({
  titleKey,
  subtitleKey,
  actions,
  meta,
}: {
  titleKey: MessageKey;
  subtitleKey: MessageKey;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">{t(titleKey)}</h2>
          {meta}
        </div>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">{t(subtitleKey)}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Controls-on-the-left, results-on-the-right. The control column is sticky so
 * long result tables can be scrolled without losing the knobs that produced
 * them.
 */
export function SplitView({
  controls,
  children,
  width = 300,
  className,
}: {
  controls: ReactNode;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  return (
    <div className={cx('flex min-h-0 flex-1 flex-col xl:flex-row', className)}>
      <div
        className="scroll-thin shrink-0 border-b border-line xl:border-b-0 xl:border-r xl:overflow-y-auto"
        style={{ width: `min(100%, ${width}px)` }}
      >
        <div className="space-y-3 p-4">{controls}</div>
      </div>
      <div className="min-w-0 flex-1 p-4 xl:p-5">{children}</div>
    </div>
  );
}

/** A titled group of controls inside the left column. */
export function ControlGroup({
  titleKey,
  hintKey,
  children,
  actions,
}: {
  titleKey?: MessageKey;
  hintKey?: MessageKey;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      {(titleKey || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {titleKey && (
            <h3 className="text-[12px] font-semibold tracking-wide text-ink">{t(titleKey)}</h3>
          )}
          {actions}
        </div>
      )}
      {hintKey && <p className="mb-2 text-[11px] leading-snug text-ink-faint">{t(hintKey)}</p>}
      {children}
    </section>
  );
}

/** Section heading used inside the results column. */
export function SectionTitle({
  titleKey,
  hint,
  actions,
}: {
  titleKey: MessageKey;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-ink">{t(titleKey)}</h3>
        {hint && <p className="mt-0.5 text-[11.5px] text-ink-muted">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

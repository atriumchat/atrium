import type { InputHTMLAttributes, ReactNode } from 'react';
import { useT } from '../../i18n';
import { EdgeTicks, TickRuler, useNarrow } from './EdgeTicks';
import './flow.css';

/**
 * The flow look on the web (DESIGN.md), the same as the phone app's (mobile/src/components/Flow.tsx): a step at a time
 * in type alone on black, one scale of ticks along the window's edge, the main button white at the bottom with back as
 * an outlined icon beside it. The server's setup wizard is built on it.
 */

const BACK = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

/**
 * The black page: the part it's in (`label`, "Server (1/3)") over the step, the ticks along the window's edge on a
 * phone, or as a ruler over the column in a bigger window.
 */
export function FlowShell({ fill, label, children }: { fill: number; label?: string; children: ReactNode }) {
  const narrow = useNarrow();
  return (
    <div className="flow">
      {narrow ? <EdgeTicks fill={fill} /> : null}
      <div className="flow-col">
        {narrow ? null : <TickRuler fill={fill} />}
        {label ? <p className="flow-label">{label}</p> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * A step: title and line, the fields, and at the bottom (within a thumb's reach on a phone) back as an outlined round
 * icon 2px from the main button. General errors and notes stand over the buttons; a field's own error goes under it.
 * `onSubmit` makes the step a form, so Enter does what the main button does.
 */
export function FlowStep({ title, sub, error, note, actions, below, onBack, onSubmit, children }: {
  title: string;
  sub?: string;
  error?: string | null;
  note?: string;
  actions?: ReactNode;
  below?: ReactNode;
  onBack?: () => void;
  onSubmit?: () => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  const body = (
    <>
      <h1 className="flow-title">{title}</h1>
      {sub ? <p className="flow-sub">{sub}</p> : null}
      {children ? <div className="flow-body">{children}</div> : null}
      <div className="flow-spacer" />
      <div className="flow-foot">
        {error ? <p className="flow-error" role="alert">{error}</p> : null}
        {note ? <p className="flow-note">{note}</p> : null}
        {actions || onBack ? (
          <div className="flow-buttons">
            {onBack ? (
              <button type="button" className="flow-back" aria-label={t('setup.back')} onClick={onBack}>
                {BACK}
              </button>
            ) : null}
            {actions}
          </div>
        ) : null}
        {below}
      </div>
    </>
  );
  return onSubmit ? (
    <form className="flow-step" onSubmit={(e) => (e.preventDefault(), onSubmit())}>
      {body}
    </form>
  ) : (
    <div className="flow-step">{body}</div>
  );
}

/** A small outlined button right of the main one, 2px off, for the way round it: skip, later. */
export function FlowSecondary({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="flow-secondary" onClick={onClick}>
      {children}
    </button>
  );
}

/** The one main action: a white pill. */
export function FlowPrimary({ busy = false, disabled = false, type = 'button', onClick, children }: { busy?: boolean; disabled?: boolean; type?: 'button' | 'submit'; onClick?: () => void; children: ReactNode }) {
  return (
    <button type={type} className={`flow-primary${busy ? ' busy' : ''}`} disabled={disabled || busy} onClick={onClick}>
      {children}
    </button>
  );
}

/** A field as a line: its name small above, the text big on a hairline (white while typing, red when wrong), the error under it. */
export function LineField({ label, suffix, error, bad = false, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; suffix?: string; error?: string | false; bad?: boolean }) {
  return (
    <label className={`flow-field${error || bad ? ' bad' : ''}`}>
      <span className="flow-field-label">{label}</span>
      <span className="flow-line">
        <input spellCheck={false} autoComplete="off" {...input} />
        {suffix ? <span className="flow-suffix">{suffix}</span> : null}
      </span>
      {error ? <span className="flow-field-error" role="alert">{error}</span> : null}
    </label>
  );
}

/** A text button: skip, later, copy. White and underlined, so it doesn't pass for a caption; centred unless `left`. */
export function TextAction({ onClick, left = false, children }: { onClick: () => void; left?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`flow-text-action${left ? ' left' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** One of a few ways, picked with a radio button on the right: a row between hairlines. */
export function RadioRow({ title, sub, on, onClick, last = false }: { title: string; sub?: string; on: boolean; onClick: () => void; last?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`flow-radio${last ? ' last' : ''}${on ? ' on' : ''}`} onClick={onClick}>
      <span className="flow-radio-text">
        <span className="flow-radio-title">{title}</span>
        {sub ? <span className="flow-radio-sub">{sub}</span> : null}
      </span>
      <span className="flow-radio-dot" aria-hidden="true" />
    </button>
  );
}

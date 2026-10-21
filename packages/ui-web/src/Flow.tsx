import { createContext, useContext, type InputHTMLAttributes } from 'react';
import type {
  FlowLabels,
  FlowPrimaryProps,
  FlowProviderProps,
  FlowSecondaryProps,
  FlowShellProps,
  FlowStepProps,
  KeptRowProps,
  LineFieldProps,
  RadioRowProps,
  TextActionProps,
} from '@gomex/ui-common';
import { EdgeTicks, TickRuler, useNarrow } from './EdgeTicks';
import { ChevronLeft } from './icons';
import './flow.css';

/**
 * Gomex Flow on the web (DESIGN.md), the props from @gomex/ui-common's contract, the same parts as @gomex/ui-native: a
 * step at a time in type alone on black, one scale of ticks along the window's edge, the main button white at the
 * bottom with back as an outlined icon beside it.
 */

const Labels = createContext<FlowLabels>({ back: 'Back' });

/** The words the parts say themselves, in the app's language; English without it. */
export function FlowProvider({ labels, children }: FlowProviderProps) {
  return <Labels.Provider value={labels}>{children}</Labels.Provider>;
}

/**
 * The black page: the part it's in (`label`, "Server (1/3)") over the step, the ticks along the window's edge on a
 * phone, or as a ruler over the column in a bigger window.
 */
export function FlowShell({ fill, label, bottom, children }: FlowShellProps) {
  const narrow = useNarrow();
  return (
    <div className="flow">
      {narrow ? <EdgeTicks fill={fill} /> : null}
      <div className="flow-col">
        {narrow ? null : <TickRuler fill={fill} />}
        {label ? <p className="flow-label">{label}</p> : null}
        {children}
      </div>
      {bottom ? <div className="flow-bottom">{bottom}</div> : null}
    </div>
  );
}

/**
 * A step: title and line, the fields, and at the bottom (within a thumb's reach on a phone) back as an outlined round
 * icon 2px from the main button. General errors and notes stand over the buttons; a field's own error goes under it.
 * `onSubmit` makes the step a form, so Enter does what the main button does.
 */
export function FlowStep({ title, sub, error, note, noteHidden = false, actions, aside, below, onBack, onSubmit, children }: FlowStepProps) {
  const labels = useContext(Labels);
  const body = (
    <>
      <h1 className="flow-title">{title}</h1>
      {sub ? <p className="flow-sub">{sub}</p> : null}
      {children ? <div className="flow-body">{children}</div> : null}
      <div className="flow-spacer" />
      <div className="flow-foot">
        {error ? <p className="flow-error" role="alert">{error}</p> : null}
        {note ? <p className={`flow-note${noteHidden ? ' hidden' : ''}`}>{note}</p> : null}
        {actions || onBack || aside ? (
          <div className="flow-buttons">
            {onBack ? (
              <button type="button" className="flow-back" aria-label={labels.back} onClick={onBack}>
                <ChevronLeft />
              </button>
            ) : null}
            {actions}
            {aside}
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

/** The one main action: a white pill. In a step with `onSubmit`, `type="submit"` makes it the form's button. */
export function FlowPrimary({ busy = false, disabled = false, type = 'button', onPress, children }: FlowPrimaryProps & { type?: 'button' | 'submit' }) {
  return (
    <button type={type} className={`flow-primary${busy ? ' busy' : ''}`} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onPress}>
      {children}
    </button>
  );
}

/** A small outlined button right of the main one, 2px off, for the way round it: skip, later. */
export function FlowSecondary({ onPress, children }: FlowSecondaryProps) {
  return (
    <button type="button" className="flow-secondary" onClick={onPress}>
      {children}
    </button>
  );
}

/** A field as a line: its name small above, the text big on a hairline (white while typing, red when wrong), the error under it. */
export function LineField({ label, suffix, trailing, error, bad = false, ...input }: LineFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, keyof LineFieldProps>) {
  return (
    <label className={`flow-field${error || bad ? ' bad' : ''}`}>
      <span className="flow-field-label">{label}</span>
      <span className="flow-line">
        <input spellCheck={false} autoComplete="off" aria-invalid={error || bad ? true : undefined} {...input} />
        {suffix ? <span className="flow-suffix">{suffix}</span> : null}
        {trailing}
      </span>
      {error ? <span className="flow-field-error" role="alert">{error}</span> : null}
    </label>
  );
}

/** A text button: skip, later, copy. White and underlined, so it doesn't pass for a caption; centred unless `left`. */
export function TextAction({ onPress, left = false, children }: TextActionProps) {
  return (
    <button type="button" className={`flow-text-action${left ? ' left' : ''}`} onClick={onPress}>
      {children}
    </button>
  );
}

/** One of a few ways, picked with a radio button on the right: a row between hairlines. */
export function RadioRow({ title, sub, on, onPress, last = false }: RadioRowProps) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`flow-radio${last ? ' last' : ''}`} onClick={onPress}>
      <span className="flow-radio-text">
        <span className="flow-radio-title">{title}</span>
        {sub ? <span className="flow-radio-sub">{sub}</span> : null}
      </span>
      <span className="flow-radio-dot" aria-hidden="true" />
    </button>
  );
}

/** Something kept from before on this device, with what to do with it underlined on the right. */
export function KeptRow({ label, go, onPress }: KeptRowProps) {
  return (
    <button type="button" className="flow-kept" onClick={onPress}>
      <span>{label}</span>
      <u>{go}</u>
    </button>
  );
}

import { drum, drumAt, interpolate, type DrumProps } from '@atrium/ui-common';
import { Check, Cross } from './icons';

/**
 * A long job's steps on a drum (the installer's): the running one in the middle, the done ones fading above it, the
 * coming ones below. The motion's numbers are @atrium/ui-common's `drum`, the same as the phone app's.
 */
export function Drum({ items, current, shown = 5 }: DrumProps) {
  const at = drumAt(items, current);
  return (
    <div className="flow-drum" style={{ height: drum.row * shown }}>
      <ol style={{ transform: `translateY(${(Math.floor(shown / 2) - at) * drum.row}px)` }}>
        {items.map((item, i) => {
          const away = Math.abs(i - at);
          return (
            <li
              key={item.id}
              className={item.state}
              aria-current={i === at ? 'step' : undefined}
              style={{ opacity: interpolate(away, drum.away, drum.opacity) }}
            >
              {/* Only the words shrink away from the middle: the marks keep one column. */}
              <span style={{ transform: `scale(${interpolate(away, drum.scaleAway, drum.scale)})` }}>{item.label}</span>
              {item.state === 'run' ? <i className="spin" aria-hidden="true" /> : null}
              {item.state === 'done' ? <Check /> : null}
              {item.state === 'fail' ? <Cross /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

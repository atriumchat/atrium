import type { FlowParts } from '@atrium/ui-common';
import { Drum } from './Drum';
import { FlowPrimary, FlowProvider, FlowSecondary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, TextAction } from './Flow';

/** The contract, checked: a part missing here, or taking other props than @atrium/ui-common says, fails to compile. */
export const parts = { FlowProvider, FlowShell, FlowStep, FlowPrimary, FlowSecondary, TextAction, LineField, RadioRow, KeptRow, Drum } satisfies FlowParts;

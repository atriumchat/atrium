/** The round mark at the end of a choice in a list; filled for the one chosen. */
export function Radio({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={`ml-auto grid size-5 shrink-0 place-items-center rounded-full border ${on ? 'border-foreground' : 'border-white/25'}`}>
      {on && <span className="size-2.5 rounded-full bg-foreground" />}
    </span>
  );
}

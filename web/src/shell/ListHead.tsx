import type { ReactNode } from 'react';
import { SearchIcon } from '../ui/icons';

/**
 * The top of the left list on a computer: the place's name big and light (the Metro part of the look), a line under it,
 * an action beside the name, then the search pill. On a phone the tab bar's screen has its own title, so only the
 * search shows there.
 */
export function ListHead(props: {
  title: string;
  sub: string;
  action?: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  // A computer: name and action, the line, the search. The search is as wide as the rows under it (8 from the panel's
  // edge, the title sits at 20), so its glass lines up with the rows' icons. A phone: the search with the action beside it.
  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-5 pb-2 pt-5 max-md:px-3 max-md:pt-3">
      <h1 className="col-start-1 row-start-1 truncate text-[32px] font-light leading-[38px] tracking-[-0.8px] text-foreground max-md:hidden">
        {props.title}
      </h1>
      {props.action && <div className="col-start-2 row-start-1">{props.action}</div>}
      <p className="col-span-2 row-start-2 truncate text-[14px] text-muted max-md:hidden">{props.sub}</p>
      <label className="col-span-2 row-start-3 -mx-3 mt-4 flex h-10 items-center gap-2.5 rounded-full bg-default px-4 text-faint focus-within:ring-2 focus-within:ring-focus max-md:col-span-1 max-md:row-start-1 max-md:mx-0 max-md:mt-0 max-md:h-12">
        <SearchIcon size={16} />
        <input
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-faint max-md:text-[17px]"
        />
      </label>
    </header>
  );
}

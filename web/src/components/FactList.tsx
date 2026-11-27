import { createContext, type ReactNode, useContext } from "react";

import { cn } from "@/lib/cn";

/**
 * How a `FactList` sets out its rows:
 *
 * - `aligned`: label and value side by side, every value starting on one line
 *   and a long one wrapping under itself. A song's credits under its title.
 * - `stacked`: each label over its value, for a column too narrow for two.
 * - `justified`: the label at the start and the value at the end, the rows
 *   ruled apart. A song's tallies.
 */
export type FactLayout = "aligned" | "stacked" | "justified";

const listLayouts: Record<FactLayout, string> = {
  aligned: "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1",
  stacked: "space-y-2",
  justified: "divide-y divide-line",
};

const rowLayouts: Record<FactLayout, string> = {
  aligned: "col-span-2 grid grid-cols-subgrid",
  stacked: "",
  justified: "flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0",
};

const valueLayouts: Record<FactLayout, string> = {
  aligned: "",
  stacked: "",
  justified: "text-right",
};

/** The row classes the list's layout gives its facts, plus the caller's own. */
const RowClasses = createContext<{ row: string; value: string }>({ row: "", value: "" });

/**
 * Labeled facts, as a description list: credits, tallies.
 *
 * `className` and `rowClassName` take what a layout cannot say alone, such as
 * a container query that switches it (`cn` is a plain join, so they add to the
 * layout's classes rather than replace them).
 */
export function FactList({
  layout,
  className,
  rowClassName,
  children,
}: {
  layout: FactLayout;
  className?: string;
  rowClassName?: string;
  children: ReactNode;
}) {
  return (
    <dl className={cn(listLayouts[layout], className)}>
      <RowClasses.Provider
        value={{ row: cn(rowLayouts[layout], rowClassName), value: valueLayouts[layout] }}
      >
        {children}
      </RowClasses.Provider>
    </dl>
  );
}

/** One labeled fact. `detail` is a quieter line under the value. */
export function Fact({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string | undefined;
  children: ReactNode;
}) {
  const classes = useContext(RowClasses);
  return (
    <div className={classes.row}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn("font-medium", classes.value)}>
        {children}
        {detail && <span className="block text-sm font-normal text-fg-muted">{detail}</span>}
      </dd>
    </div>
  );
}

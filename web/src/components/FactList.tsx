import { createContext, type ReactNode, useContext } from "react";

import { cn } from "@/lib/cn";

/**
 * How a `FactList` sets out its rows:
 *
 * - `aligned`: label and value side by side, every value starting on one line
 *   and a long one wrapping under itself. Narrower than 20rem, too narrow for a
 *   second column of names, each label sits over its value instead. A song's
 *   credits, under its title and in the column beside the lyrics.
 * - `justified`: the label at the start and the value at the end, the rows
 *   ruled apart. A song's tallies.
 */
export type FactLayout = "aligned" | "justified";

// The list is the container its rows ask about: its own width, not the
// window's, decides whether two columns fit.
const listLayouts: Record<FactLayout, string> = {
  aligned: "@container grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1",
  justified: "divide-y divide-line",
};

const rowLayouts: Record<FactLayout, { row: string; value: string }> = {
  aligned: { row: "col-span-2 grid grid-cols-subgrid @max-xs:block @max-xs:pb-1", value: "" },
  justified: {
    row: "flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0",
    value: "text-right",
  },
};

const Layout = createContext<FactLayout>("aligned");

/** Labeled facts, as a description list: credits, tallies. */
export function FactList({
  layout,
  className,
  children,
}: {
  layout: FactLayout;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl className={cn(listLayouts[layout], className)}>
      <Layout.Provider value={layout}>{children}</Layout.Provider>
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
  const { row, value } = rowLayouts[useContext(Layout)];
  return (
    <div className={row}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn("font-medium", value)}>
        {children}
        {detail && <span className="block text-sm font-normal text-fg-muted">{detail}</span>}
      </dd>
    </div>
  );
}

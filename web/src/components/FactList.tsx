import { createContext, type ReactNode, useContext } from "react";

import { cn } from "@/lib/cn";

/**
 * How a `FactList` sets out its rows:
 *
 * - `inline`: the facts run on as one band, each label just before its value,
 *   wrapping between facts, as a record sleeve prints its credits. A long value
 *   wraps within its fact. A song's credits, under its title.
 * - `justified`: the label at the start and the value at the end, the rows
 *   ruled apart. A song's tallies.
 */
export type FactLayout = "inline" | "justified";

const listLayouts: Record<FactLayout, string> = {
  inline: "flex flex-wrap gap-x-6 gap-y-1",
  justified: "divide-y divide-line",
};

// An inline label keeps its line: a long value beside it wraps, not the label.
const rowLayouts: Record<FactLayout, { row: string; label: string; value: string }> = {
  inline: { row: "flex min-w-0 items-baseline gap-1.5", label: "shrink-0", value: "min-w-0" },
  justified: {
    row: "flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0",
    label: "",
    value: "text-right",
  },
};

const Layout = createContext<FactLayout>("inline");

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
  const { row, label: labelLayout, value } = rowLayouts[useContext(Layout)];
  return (
    <div className={row}>
      <dt className={cn("text-fg-muted", labelLayout)}>{label}</dt>
      <dd className={cn("font-medium", value)}>
        {children}
        {detail && <span className="block text-sm font-normal text-fg-muted">{detail}</span>}
      </dd>
    </div>
  );
}

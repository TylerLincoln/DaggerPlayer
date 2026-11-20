import { Fragment, type ReactNode } from "react";

/** A row of short facts parted by hairlines (never a middle-dot string). Falsy items are skipped. */
export function Meta({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  return (
    <span className={`meta ${className}`.trim()}>
      {shown.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span>{x}</span>
        </Fragment>
      ))}
    </span>
  );
}

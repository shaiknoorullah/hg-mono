/**
 * The public pages' route layout (SI §0): the AuthTop header (brand, no navigation), then a
 * centred 480px column in `<main>`. The document never scrolls: the header stays, and only
 * `<main>` scrolls when a tall error card meets a short screen. The cards, links, support lines
 * and wait lines inside come from the DS seam (`../ds`), not from here.
 */
import { Outlet } from "react-router-dom";
import { BrandAppBar } from "../ds";
import { CONTEXT_LABEL } from "./copy";

/** Route layout for every public page. */
export function AuthLayout() {
  return (
    <div
      className="flex h-full flex-col bg-surface-base font-ui text-fg-primary"
      data-testid="auth-frame"
    >
      <BrandAppBar context={CONTEXT_LABEL} />
      <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 pb-6 pt-6 xl:pt-12">
        <div className="flex w-[480px] max-w-full flex-col gap-6 [&>*]:shrink-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

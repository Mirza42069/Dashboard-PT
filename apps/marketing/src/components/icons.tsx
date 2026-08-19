/**
 * Every icon on the marketing site, as components.
 *
 * Same glyph family and the same wrapping approach as the product's own barrel
 * (packages/ui/src/components/icons.tsx), so the site and the dashboard
 * screenshots it embeds are drawn from one set. The five shared glyphs point at
 * the exact icons the product already uses.
 *
 * This app deliberately does not depend on @DashboardV2/ui — it ships its own
 * hand-written CSS and no design-system runtime — so Hugeicons is imported
 * directly here rather than through the shared package.
 *
 * Hugeicons ships icons as data, not components; its own shape is
 * `<HugeiconsIcon icon={Tick02Icon} />`. Wrapping once here keeps call sites as
 * `<Check />`, and lets a glyph be re-pointed by editing one line.
 *
 * Sizing note: HugeiconsIcon renders width/height attributes of 24. Every rule
 * in globals.css sets only `width`, so the base `svg { height: auto }` there is
 * what keeps these in proportion. Do not remove it.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon as HiArrowDown01,
  ArrowRight01Icon as HiArrowRight01,
  File01Icon as HiFile01,
  LockIcon as HiLock,
  RefreshIcon as HiRefresh,
  Tick02Icon as HiTick02,
} from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";

type Glyph = ComponentProps<typeof HugeiconsIcon>["icon"];
export type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;

function icon(glyph: Glyph, name: string) {
  /*
   * aria-hidden before the spread on purpose: every icon here sits inside a
   * control that already carries its own accessible name, so announcing the
   * icon again would repeat it with nothing to add. A call site that ever needs
   * the icon named can pass aria-hidden={false} with a label and win.
   */
  function Icon(props: IconProps) {
    return <HugeiconsIcon icon={glyph} aria-hidden {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowDown = icon(HiArrowDown01, "ArrowDown");
export const ArrowRight = icon(HiArrowRight01, "ArrowRight");
export const Check = icon(HiTick02, "Check");
export const File = icon(HiFile01, "File");
export const Lock = icon(HiLock, "Lock");
export const Refresh = icon(HiRefresh, "Refresh");

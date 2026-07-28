import { interpolate, type Dictionary } from "@/i18n";

/**
 * Names the rows a destructive action is about to affect.
 *
 * "Delete 12 item(s)?" tells the user a number and nothing else, which is thin
 * grounds for confirming something irreversible that also cascades. Listing a
 * few codes lets them recognise a mistake before it happens, and the tail keeps
 * the dialog from turning into a wall of text on a large selection.
 */
export function summarizeSelection(
  labels: string[],
  t: Dictionary,
  max = 5,
): string {
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  if (rest <= 0) return shown.join(", ");
  return `${shown.join(", ")} ${interpolate(t.common.andMore, { count: rest })}`;
}

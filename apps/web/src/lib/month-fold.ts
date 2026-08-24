/**
 * The months the reader has folded, keyed by `monthKey` ("YYYY-MM").
 *
 * A folded month collapses its run of periods into one column, which is how a
 * year-long weekly project stops being fifty-two columns wide. It is a display
 * state and nothing else: no period is dropped, no value is recomputed, and
 * unfolding puts every column back exactly as it was.
 *
 * This was once a map of *intent* — "folded" / "unfolded" — because a fitter
 * folded months automatically and the two wrote into the same state: press the
 * chevron on a month the fitter had folded and it simply folded it again, so
 * the control looked broken. Nothing folds on its own any more, so what is
 * stored is what is rendered, and a set says that plainly.
 */
export type MonthFoldState = ReadonlySet<string>;

/** Folds a month if it is open, unfolds it if it is not. */
export function toggleFold(state: MonthFoldState, monthKey: string): MonthFoldState {
  const next = new Set(state);
  if (!next.delete(monthKey)) next.add(monthKey);
  return next;
}

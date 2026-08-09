export function pageWithFocus<T>(rows: T[], focused: T | undefined, limit: number) {
  const regularLimit = focused ? Math.max(0, limit - 1) : limit;
  const regularPage = rows.slice(0, regularLimit);
  const hasMore = rows.length > regularLimit;

  return {
    items: focused ? [focused, ...regularPage] : regularPage,
    next: !hasMore
      ? null
      : regularPage.length > 0
        ? { row: regularPage[regularPage.length - 1]!, inclusive: false }
        : { row: rows[0]!, inclusive: true },
  };
}

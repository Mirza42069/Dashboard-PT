import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SCurveTooltip } from "./s-curve-chart";

test("S-curve tooltip keeps translated labels, zero values and one-decimal percentages", () => {
  const props = {
    active: true,
    label: "W1",
    labels: { planned: "Rencana", actual: "Aktual" },
    payload: [
      { graphicalItemId: "planned", dataKey: "planned", name: "planned", value: 12.34, color: "var(--chart-4)" },
      { graphicalItemId: "actual", dataKey: "actual", name: "actual", value: 0, color: "var(--chart-1)" },
    ],
  };
  const html = renderToStaticMarkup(<SCurveTooltip {...props} />);
  for (const text of ["W1", "Rencana", "Aktual", "12.3%", "0.0%", "var(--chart-4)", "var(--chart-1)"]) {
    expect(html).toContain(text);
  }
  expect(renderToStaticMarkup(<SCurveTooltip {...props} active={false} />)).toBe("");
  expect(renderToStaticMarkup(<SCurveTooltip {...props} payload={[]} />)).toBe("");
});

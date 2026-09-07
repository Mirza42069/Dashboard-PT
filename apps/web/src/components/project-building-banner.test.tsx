import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ProjectBuildingBanner from "./project-building-banner";

test("banner reserves its space without server-rendering or preloading Three.js", () => {
  const html = renderToStaticMarkup(<ProjectBuildingBanner seed="P-001" />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("h-full min-h-0");
  expect(html).toContain("linear-gradient");
  expect(html).not.toContain("<canvas");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<link");
});

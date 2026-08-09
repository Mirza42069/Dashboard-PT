import { describe, expect, test } from "bun:test";

import { hasPermission } from "./permissions";

describe("role permissions", () => {
  test("management users can create projects and read activity", () => {
    expect(hasPermission("user", "project:create")).toBe(true);
    expect(hasPermission("user", "activity:read")).toBe(true);
    expect(hasPermission("user", "project:delete")).toBe(false);
    expect(hasPermission("user", "progress:review")).toBe(false);
  });

  test("supervisors retain project oversight without system company switching", () => {
    expect(hasPermission("admin", "project:create")).toBe(true);
    expect(hasPermission("admin", "activity:read")).toBe(true);
    expect(hasPermission("admin", "progress:review")).toBe(true);
    expect(hasPermission("admin", "company:switch")).toBe(false);
    expect(hasPermission("admin", "user:rename")).toBe(false);
    expect(hasPermission("admin", "support:manage")).toBe(false);
    expect(hasPermission("user", "support:manage")).toBe(false);
  });

  test("system accounts control every permission", () => {
    expect(hasPermission("super_admin", "company:switch")).toBe(true);
    expect(hasPermission("super_admin", "company:manage")).toBe(true);
    expect(hasPermission("super_admin", "user:rename")).toBe(true);
    expect(hasPermission("super_admin", "support:manage")).toBe(true);
  });
});

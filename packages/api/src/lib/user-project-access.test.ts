import { describe, expect, test } from "bun:test";

import { planProjectAccessReconciliation } from "./user-project-access";

describe("user project access reconciliation", () => {
  test("grants managed projects when an admin becomes a regular user", () => {
    expect(
      planProjectAccessReconciliation({
        companyId: "company-a",
        managedProjectIds: ["project-a", "project-a", "project-b"],
        memberships: [],
        role: "user",
      }),
    ).toEqual({
      grantProjectIds: ["project-a", "project-b"],
      staleProjectIds: [],
    });
  });

  test("removes memberships outside a regular user's current company", () => {
    expect(
      planProjectAccessReconciliation({
        companyId: "company-b",
        managedProjectIds: [],
        memberships: [
          { companyId: "company-a", projectId: "project-a" },
          { companyId: "company-b", projectId: "project-b" },
        ],
        role: "user",
      }).staleProjectIds,
    ).toEqual(["project-a"]);
  });

  test("removes all membership rows for company-wide roles", () => {
    expect(
      planProjectAccessReconciliation({
        companyId: "company-a",
        managedProjectIds: ["project-a"],
        memberships: [
          { companyId: "company-a", projectId: "project-a" },
          { companyId: "company-b", projectId: "project-b" },
        ],
        role: "admin",
      }),
    ).toEqual({
      grantProjectIds: [],
      staleProjectIds: ["project-a", "project-b"],
    });
  });
});

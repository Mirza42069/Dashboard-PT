import { describe, expect, test } from "bun:test";

import { canAssignProjectManager, projectMembershipIds } from "./project-manager";

describe("project manager assignment policy", () => {
  test("supervisors may appoint or clear any manager", () => {
    expect(
      canAssignProjectManager({
        actorId: "admin",
        canManageMembers: true,
        currentManagerId: "manager-a",
        nextManagerId: "manager-b",
      }),
    ).toBe(true);
    expect(
      canAssignProjectManager({
        actorId: "admin",
        canManageMembers: true,
        currentManagerId: "manager-a",
        nextManagerId: null,
      }),
    ).toBe(true);
  });

  test("regular users may assign or clear only themselves", () => {
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: null,
        nextManagerId: "user-a",
      }),
    ).toBe(true);
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: "user-a",
        nextManagerId: null,
      }),
    ).toBe(true);
  });

  test("regular users cannot appoint colleagues or displace their manager", () => {
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: null,
        nextManagerId: "user-b",
      }),
    ).toBe(false);
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: "user-b",
        nextManagerId: "user-a",
      }),
    ).toBe(false);
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: "user-b",
        nextManagerId: null,
      }),
    ).toBe(false);
  });

  test("resubmitting the current manager is always allowed", () => {
    expect(
      canAssignProjectManager({
        actorId: "user-a",
        canManageMembers: false,
        currentManagerId: "user-b",
        nextManagerId: "user-b",
      }),
    ).toBe(true);
  });
});

describe("project membership composition", () => {
  test("deduplicates a regular-user creator who manages their own project", () => {
    expect(
      projectMembershipIds({
        creatorId: "user-a",
        creatorRole: "user",
        manager: { id: "user-a", role: "user" },
      }),
    ).toEqual(["user-a"]);
  });

  test("adds a regular-user manager but not an admin manager", () => {
    expect(
      projectMembershipIds({
        creatorId: "admin-a",
        creatorRole: "admin",
        manager: { id: "user-a", role: "user" },
      }),
    ).toEqual(["user-a"]);
    expect(
      projectMembershipIds({
        creatorId: "user-a",
        creatorRole: "user",
        manager: { id: "admin-a", role: "admin" },
      }),
    ).toEqual(["user-a"]);
  });
});

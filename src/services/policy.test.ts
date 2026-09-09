import { describe, expect, test } from "vitest";
import { assertStatusTransition, taskActions } from "./policy";

const frontend = {
  id: "frontend-1",
  email: "frontend@nodewave.test",
  name: "Frontend Engineer",
  role: "INTERNAL_TEAM" as const,
  department: "FRONTEND" as const,
  clientProjectId: null,
};

describe("state-based task permission", () => {
  test("executor cannot start while a prerequisite is unfinished", () => {
    const task = {
      status: "TODO" as const,
      department: "FRONTEND" as const,
      assigneeId: frontend.id,
    };
    expect(taskActions(frontend, task, 1).canStartWhenReady).toBe(true);
    expect(taskActions(frontend, task, 1).canStart).toBe(false);
    expect(() =>
      assertStatusTransition(frontend, task, "IN_PROGRESS", 1),
    ).toThrow("blocked");
  });

  test("executor can start after all prerequisites are done", () => {
    const task = {
      status: "TODO" as const,
      department: "FRONTEND" as const,
      assigneeId: frontend.id,
    };
    expect(taskActions(frontend, task, 0).canStart).toBe(true);
    expect(() =>
      assertStatusTransition(frontend, task, "IN_PROGRESS", 0),
    ).not.toThrow();
  });

  test("assignee from another department is not treated as the executor", () => {
    const task = {
      status: "TODO" as const,
      department: "BACKEND" as const,
      assigneeId: frontend.id,
    };
    const actions = taskActions(frontend, task, 0);
    expect(actions.canStart).toBe(false);
    expect(actions.canAttach).toBe(false);
  });

  test("PM cannot complete work on behalf of the executor", () => {
    const pm = {
      ...frontend,
      id: "pm-1",
      role: "PRODUCT_MANAGER" as const,
      department: "PRODUCT" as const,
    };
    const task = {
      status: "IN_PROGRESS" as const,
      department: "FRONTEND" as const,
      assigneeId: frontend.id,
    };
    const actions = taskActions(pm, task, 0);
    expect(actions.canEditCore).toBe(true);
    expect(actions.canAddDependency).toBe(true);
    expect(actions.canDelete).toBe(true);
    expect(actions.canComplete).toBe(false);
    expect(() => assertStatusTransition(pm, task, "DONE", 0)).toThrow(
      "tidak diizinkan",
    );
  });
});

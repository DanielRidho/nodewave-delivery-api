import { describe, expect, test } from "vitest";
import { serializeTask } from "./task-view";

const task = {
  id: "visible-task",
  projectId: "tenant-a",
  title: "Client milestone",
  description: "An approved client-facing milestone.",
  status: "TODO" as const,
  department: "FRONTEND" as const,
  assigneeId: "internal-user",
  clientVisible: true,
  dueDate: null,
  version: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignee: {
    id: "internal-user",
    name: "Secret Engineer",
    email: "secret@internal.test",
    avatarUrl: "https://internal.test/avatar.png",
    department: "FRONTEND",
  },
  prerequisites: [
    {
      id: "dependency-row",
      prerequisiteTask: {
        id: "internal-task",
        title: "Secret infrastructure task",
        status: "IN_PROGRESS" as const,
      },
    },
  ],
  attachments: [
    {
      id: "internal-attachment",
      fileName: "Internal handoff",
      fileUrl: "https://internal.test/secret",
      createdAt: new Date(),
    },
  ],
  comments: [
    {
      id: "internal-comment",
      body: "Secret internal discussion",
      createdAt: new Date(),
      user: {
        id: "internal-user",
        name: "Secret Engineer",
        department: "FRONTEND",
      },
    },
  ],
};

describe("client task response masking", () => {
  test("uses an allow-list and omits all internal identity and dependency details", () => {
    const result = serializeTask(task, {
      id: "client-a",
      email: "client@tenant.test",
      name: "Client",
      role: "CLIENT_GUEST",
      department: "CLIENT",
      clientProjectId: "tenant-a",
    });

    expect(result.effectiveStatus).toBe("BLOCKED");
    expect(result.dependencies).toEqual([]);
    expect(result.blockedBy).toEqual([]);
    expect(result.attachments).toEqual([]);
    expect(result).not.toHaveProperty("assignee");
    expect(result).not.toHaveProperty("department");
    expect(result).not.toHaveProperty("comments");
    expect(result).not.toHaveProperty("permissions");
    expect(JSON.stringify(result)).not.toContain("Secret Engineer");
    expect(JSON.stringify(result)).not.toContain("Secret infrastructure task");
    expect(JSON.stringify(result)).not.toContain("Secret internal discussion");
    expect(JSON.stringify(result)).not.toContain("internal.test/secret");
  });
});

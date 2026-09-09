import type { AuthUser } from "../types";
import { taskActions } from "./policy";

type TaskWithRelations = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  department: "PRODUCT" | "UI_UX" | "FRONTEND" | "BACKEND" | "CLIENT";
  assigneeId: string | null;
  clientVisible: boolean;
  dueDate: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  assignee: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    department: string;
  } | null;
  prerequisites: Array<{
    id: string;
    prerequisiteTask: {
      id: string;
      title: string;
      status: "TODO" | "IN_PROGRESS" | "DONE";
    };
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    fileUrl: string;
    createdAt: Date;
  }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: Date;
    user: {
      id: string;
      name: string;
      department: string;
    };
  }>;
};

export const serializeTask = (task: TaskWithRelations, user: AuthUser) => {
  const pending = task.prerequisites.filter(
    ({ prerequisiteTask }) => prerequisiteTask.status !== "DONE",
  );
  const actions = taskActions(user, task, pending.length);
  const base = {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    effectiveStatus:
      task.status === "TODO" && pending.length > 0 ? "BLOCKED" : task.status,
    clientVisible: task.clientVisible,
    dueDate: task.dueDate,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  // This is deliberate response-level masking. Client responses never contain
  // assignee identity, department, permissions, audit history, or comments.
  if (user.role === "CLIENT_GUEST") {
    return { ...base, attachments: [], dependencies: [], blockedBy: [] };
  }

  return {
    ...base,
    department: task.department,
    assignee: task.assignee,
    attachments: task.attachments,
    comments: task.comments,
    dependencies: task.prerequisites.map(({ id, prerequisiteTask }) => ({
      id,
      taskId: prerequisiteTask.id,
      title: prerequisiteTask.title,
      status: prerequisiteTask.status,
    })),
    blockedBy: pending.map(({ prerequisiteTask }) => ({
      id: prerequisiteTask.id,
      title: prerequisiteTask.title,
    })),
    permissions: actions,
  };
};

export const taskInclude = {
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      department: true,
    },
  },
  prerequisites: {
    where: { deletedAt: null, prerequisiteTask: { deletedAt: null } },
    include: {
      prerequisiteTask: { select: { id: true, title: true, status: true } },
    },
  },
  attachments: {
    where: { deletedAt: null },
    select: { id: true, fileName: true, fileUrl: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
  comments: {
    where: { deletedAt: null },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { id: true, name: true, department: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
};

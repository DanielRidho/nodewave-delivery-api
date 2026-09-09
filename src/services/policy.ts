import type { Department, TaskStatus } from "../generated/prisma/enums";
import type { AuthUser } from "../types";

export type PolicyTask = {
  status: TaskStatus;
  department: Department;
  assigneeId: string | null;
};

export const canReadProject = (
  user: AuthUser,
  projectId: string,
  isMember: boolean,
) => {
  if (user.role === "PRODUCT_MANAGER") return true;
  if (user.role === "CLIENT_GUEST") return user.clientProjectId === projectId;
  return isMember;
};

export const taskActions = (
  user: AuthUser,
  task: PolicyTask,
  unmetDependencies: number,
) => {
  const isPm = user.role === "PRODUCT_MANAGER";
  const isExecutor =
    user.role === "INTERNAL_TEAM" &&
    task.assigneeId === user.id &&
    user.department === task.department;

  return {
    canEditCore: isPm,
    canDelete: isPm,
    canAddDependency: isPm,
    canAttach: isPm || isExecutor,
    canStartWhenReady: (isPm || isExecutor) && task.status === "TODO",
    canStart:
      (isPm || isExecutor) && task.status === "TODO" && unmetDependencies === 0,
    canComplete: isExecutor && task.status === "IN_PROGRESS",
    blockedReason:
      task.status === "TODO" && unmetDependencies > 0
        ? `${unmetDependencies} prerequisite belum selesai`
        : null,
  };
};

export const assertStatusTransition = (
  user: AuthUser,
  task: PolicyTask,
  nextStatus: TaskStatus,
  unmetDependencies: number,
) => {
  const actions = taskActions(user, task, unmetDependencies);

  if (nextStatus === task.status) return;
  if (
    task.status === "TODO" &&
    nextStatus === "IN_PROGRESS" &&
    actions.canStart
  )
    return;
  if (
    task.status === "IN_PROGRESS" &&
    nextStatus === "DONE" &&
    actions.canComplete
  )
    return;

  throw new Error(
    unmetDependencies > 0
      ? "Task masih blocked oleh prerequisite yang belum selesai."
      : "Transisi status ini tidak diizinkan untuk peran atau assignee saat ini.",
  );
};

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import {
  buildListQuery,
  type ListQueryDefinition,
  paginationMeta,
} from "../lib/list-query";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { authMiddleware } from "../middleware/auth";
import { assertPm, assertProjectAccess } from "../services/access";
import { assertStatusTransition, taskActions } from "../services/policy";
import { serializeTask, taskInclude } from "../services/task-view";
import type { AppEnv } from "../types";

const departmentSchema = z.enum(["PRODUCT", "UI_UX", "FRONTEND", "BACKEND"]);
const statusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  department: departmentSchema,
  assigneeId: z.string().min(1).nullable().optional(),
  clientVisible: z.boolean().default(false),
  dueDate: z.iso.datetime().nullable().optional(),
});

const updateTaskSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().min(10).max(5000).optional(),
    department: departmentSchema.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    clientVisible: z.boolean().optional(),
    dueDate: z.iso.datetime().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
    "Setidaknya satu field harus diubah.",
  );

const statusUpdateSchema = z.object({
  status: statusSchema,
  expectedVersion: z.number().int().positive(),
});

const dependencySchema = z.object({
  prerequisiteTaskId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileUrl: z.url(),
});

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const auditLogListDefinition: ListQueryDefinition = {
  filterFields: {
    changedColumn: z.string(),
    userId: z.string(),
  },
  searchFields: ["changedColumn", "user.name"],
  rangeFields: { createdAt: z.iso.datetime() },
  orderFields: ["changedColumn", "createdAt", "user.name"],
  defaultOrderBy: { createdAt: "desc" },
};

const jsonValue = (value: unknown) => {
  if (value === null || value === undefined) return Prisma.JsonNull;
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
};

const findTask = async (id: string) => {
  const task = await prisma.task.findFirst({
    where: { id, deletedAt: null, project: { deletedAt: null } },
    include: taskInclude,
  });
  if (!task) throw notFound("Task");
  return task;
};

const assertCurrentVersion = (expectedVersion: number) => {
  throw conflict(
    "Task sudah diubah oleh pengguna lain. Muat ulang data sebelum mencoba lagi.",
    { expectedVersion },
  );
};

const createsCycle = async (
  database: Pick<Prisma.TransactionClient, "taskDependency">,
  taskId: string,
  prerequisiteTaskId: string,
) => {
  const queue = [prerequisiteTaskId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const dependencies = await database.taskDependency.findMany({
      where: {
        taskId: current,
        deletedAt: null,
        prerequisiteTask: { deletedAt: null },
      },
      select: { prerequisiteTaskId: true },
    });
    queue.push(
      ...dependencies.map((dependency) => dependency.prerequisiteTaskId),
    );
  }
  return false;
};

export const taskRoutes = new Hono<AppEnv>();
taskRoutes.use("*", authMiddleware);

taskRoutes.get("/:taskId", async (c) => {
  const user = c.get("user");
  const task = await findTask(c.req.param("taskId"));
  await assertProjectAccess(user, task.projectId);
  if (user.role === "CLIENT_GUEST" && !task.clientVisible)
    throw notFound("Task");
  return ok(c, serializeTask(task, user));
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  assertPm(user);
  const input = c.req.valid("json");
  await assertProjectAccess(user, input.projectId);

  if (input.assigneeId) {
    const assignee = await prisma.projectMember.findFirst({
      where: {
        projectId: input.projectId,
        userId: input.assigneeId,
        deletedAt: null,
        user: {
          role: "INTERNAL_TEAM",
          department: input.department,
          deletedAt: null,
        },
      },
    });
    if (!assignee) {
      throw new AppError(
        400,
        "INVALID_ASSIGNEE",
        "Assignee harus anggota project dari department task.",
      );
    }
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        department: input.department,
        assigneeId: input.assigneeId ?? null,
        clientVisible: input.clientVisible,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdById: user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        taskId: created.id,
        userId: user.id,
        changedColumn: "__created",
        oldValue: Prisma.JsonNull,
        newValue: { title: created.title, status: created.status },
      },
    });
    return tx.task.findUniqueOrThrow({
      where: { id: created.id },
      include: taskInclude,
    });
  });
  return ok(c, serializeTask(task, user));
});

taskRoutes.patch(
  "/:taskId",
  zValidator("json", updateTaskSchema),
  async (c) => {
    const user = c.get("user");
    assertPm(user);
    const id = c.req.param("taskId");
    const current = await findTask(id);
    await assertProjectAccess(user, current.projectId);
    const { expectedVersion, ...input } = c.req.valid("json");

    if (input.assigneeId) {
      const department = input.department ?? current.department;
      const member = await prisma.projectMember.findFirst({
        where: {
          projectId: current.projectId,
          userId: input.assigneeId,
          deletedAt: null,
          user: { role: "INTERNAL_TEAM", department, deletedAt: null },
        },
      });
      if (!member)
        throw new AppError(
          400,
          "INVALID_ASSIGNEE",
          "Assignee tidak valid untuk department ini.",
        );
    }

    const nextValues: Record<string, unknown> = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.department !== undefined
        ? { department: input.department }
        : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId }
        : {}),
      ...(input.clientVisible !== undefined
        ? { clientVisible: input.clientVisible }
        : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
        : {}),
    };
    const changes = Object.entries(nextValues).filter(([field, value]) => {
      const oldValue = current[field as keyof typeof current];
      if (oldValue instanceof Date && value instanceof Date)
        return oldValue.getTime() !== value.getTime();
      return oldValue !== value;
    });

    if (changes.length === 0) return ok(c, serializeTask(current, user));

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id, version: expectedVersion, deletedAt: null },
        data: { ...nextValues, version: { increment: 1 } },
      });
      if (result.count === 0) assertCurrentVersion(expectedVersion);
      await tx.auditLog.createMany({
        data: changes.map(([field, value]) => ({
          taskId: id,
          userId: user.id,
          changedColumn: field,
          oldValue: jsonValue(current[field as keyof typeof current]),
          newValue: jsonValue(value),
        })),
      });
      return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    });
    return ok(c, serializeTask(updated, user));
  },
);

taskRoutes.patch(
  "/:taskId/status",
  zValidator("json", statusUpdateSchema),
  async (c) => {
    const user = c.get("user");
    const id = c.req.param("taskId");
    const current = await findTask(id);
    await assertProjectAccess(user, current.projectId);
    if (user.role === "CLIENT_GUEST") throw forbidden();
    const input = c.req.valid("json");
    const pending = current.prerequisites.filter(
      ({ prerequisiteTask }) => prerequisiteTask.status !== "DONE",
    );

    try {
      assertStatusTransition(user, current, input.status, pending.length);
    } catch (error) {
      throw forbidden(error instanceof Error ? error.message : undefined);
    }

    if (current.status === input.status)
      return ok(c, serializeTask(current, user));
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: {
          id,
          version: input.expectedVersion,
          status: current.status,
          deletedAt: null,
        },
        data: { status: input.status, version: { increment: 1 } },
      });
      if (result.count === 0) assertCurrentVersion(input.expectedVersion);
      await tx.auditLog.create({
        data: {
          taskId: id,
          userId: user.id,
          changedColumn: "status",
          oldValue: current.status,
          newValue: input.status,
        },
      });
      return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    });
    return ok(c, serializeTask(updated, user));
  },
);

taskRoutes.post(
  "/:taskId/dependencies",
  zValidator("json", dependencySchema),
  async (c) => {
    const user = c.get("user");
    assertPm(user);
    const task = await findTask(c.req.param("taskId"));
    await assertProjectAccess(user, task.projectId);
    const input = c.req.valid("json");
    if (input.prerequisiteTaskId === task.id) {
      throw new AppError(
        400,
        "SELF_DEPENDENCY",
        "Task tidak dapat bergantung pada dirinya sendiri.",
      );
    }
    const prerequisite = await findTask(input.prerequisiteTaskId);
    if (prerequisite.projectId !== task.projectId) {
      throw new AppError(
        400,
        "CROSS_PROJECT_DEPENDENCY",
        "Dependency harus berada dalam project yang sama.",
      );
    }
    const updated = await prisma.$transaction(
      async (tx) => {
        if (await createsCycle(tx, task.id, prerequisite.id)) {
          throw new AppError(
            409,
            "DEPENDENCY_CYCLE",
            "Dependency ini akan membentuk siklus.",
          );
        }
        const existingDependency = await tx.taskDependency.findFirst({
          where: {
            taskId: task.id,
            prerequisiteTaskId: prerequisite.id,
            deletedAt: null,
          },
        });
        if (existingDependency) {
          throw new AppError(
            409,
            "DEPENDENCY_EXISTS",
            "Prerequisite tersebut sudah terhubung ke task.",
          );
        }
        const versionUpdate = await tx.task.updateMany({
          where: {
            id: task.id,
            version: input.expectedVersion,
            deletedAt: null,
          },
          data: { version: { increment: 1 } },
        });
        if (versionUpdate.count === 0)
          assertCurrentVersion(input.expectedVersion);
        await tx.taskDependency.upsert({
          where: {
            taskId_prerequisiteTaskId: {
              taskId: task.id,
              prerequisiteTaskId: prerequisite.id,
            },
          },
          update: { deletedAt: null },
          create: { taskId: task.id, prerequisiteTaskId: prerequisite.id },
        });
        await tx.auditLog.create({
          data: {
            taskId: task.id,
            userId: user.id,
            changedColumn: "dependencies",
            oldValue: task.prerequisites.map(
              ({ prerequisiteTask }) => prerequisiteTask.id,
            ),
            newValue: [
              ...task.prerequisites.map(
                ({ prerequisiteTask }) => prerequisiteTask.id,
              ),
              prerequisite.id,
            ],
          },
        });
        return tx.task.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return ok(c, serializeTask(updated, user));
  },
);

taskRoutes.post(
  "/:taskId/attachments",
  zValidator("json", attachmentSchema),
  async (c) => {
    const user = c.get("user");
    const task = await findTask(c.req.param("taskId"));
    await assertProjectAccess(user, task.projectId);
    if (!taskActions(user, task, 0).canAttach) {
      throw forbidden(
        "Hanya PM atau executor task yang dapat menambah attachment.",
      );
    }
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, userId: user.id, ...c.req.valid("json") },
      select: { id: true, fileName: true, fileUrl: true, createdAt: true },
    });
    return ok(c, attachment);
  },
);

taskRoutes.post(
  "/:taskId/comments",
  zValidator("json", commentSchema),
  async (c) => {
    const user = c.get("user");
    const task = await findTask(c.req.param("taskId"));
    await assertProjectAccess(user, task.projectId);
    if (user.role === "CLIENT_GUEST")
      throw forbidden("Komentar internal tidak tersedia untuk client.");
    const comment = await prisma.comment.create({
      data: {
        taskId: task.id,
        userId: user.id,
        body: c.req.valid("json").body,
      },
      select: { id: true, body: true, createdAt: true },
    });
    return ok(c, comment);
  },
);

taskRoutes.get("/:taskId/audit-logs", async (c) => {
  const user = c.get("user");
  if (user.role === "CLIENT_GUEST")
    throw forbidden("Audit trail merupakan data internal.");
  const task = await findTask(c.req.param("taskId"));
  await assertProjectAccess(user, task.projectId);
  const listQuery = buildListQuery(c.req.query(), auditLogListDefinition);
  const where: Prisma.AuditLogWhereInput = {
    AND: [{ taskId: task.id }, listQuery.where as Prisma.AuditLogWhereInput],
  };
  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: listQuery.orderBy as Prisma.AuditLogOrderByWithRelationInput,
      skip: listQuery.skip,
      take: listQuery.take,
      include: {
        user: { select: { id: true, name: true, department: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return ok(c, logs, paginationMeta(listQuery, total));
});

taskRoutes.delete(
  "/:taskId",
  zValidator(
    "json",
    z.object({ expectedVersion: z.number().int().positive() }),
  ),
  async (c) => {
    const user = c.get("user");
    assertPm(user);
    const task = await findTask(c.req.param("taskId"));
    await assertProjectAccess(user, task.projectId);
    const { expectedVersion } = c.req.valid("json");
    await prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, version: expectedVersion, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (result.count === 0) assertCurrentVersion(expectedVersion);
      await tx.auditLog.create({
        data: {
          taskId: task.id,
          userId: user.id,
          changedColumn: "deletedAt",
          oldValue: Prisma.JsonNull,
          newValue: new Date().toISOString(),
        },
      });
    });
    return ok(c, { deleted: true });
  },
);

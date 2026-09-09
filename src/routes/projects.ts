import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import {
  buildListQuery,
  type ListQueryDefinition,
  paginationMeta,
} from "../lib/list-query";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { authMiddleware } from "../middleware/auth";
import { assertPm, assertProjectAccess } from "../services/access";
import { serializeTask, taskInclude } from "../services/task-view";
import type { AppEnv } from "../types";

const createProjectSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  accessCode: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/),
});
const updateProjectSchema = createProjectSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Setidaknya satu field harus diubah.",
  );

const dateTime = z.iso.datetime();
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
const taskDepartment = z.enum(["PRODUCT", "UI_UX", "FRONTEND", "BACKEND"]);

const projectListDefinition: ListQueryDefinition = {
  filterFields: { name: z.string() },
  searchFields: ["name", "description"],
  rangeFields: { createdAt: dateTime, updatedAt: dateTime },
  orderFields: ["name", "createdAt", "updatedAt"],
  defaultOrderBy: { createdAt: "desc" },
};

const internalTaskListDefinition: ListQueryDefinition = {
  filterFields: { status: taskStatus, department: taskDepartment },
  searchFields: ["title", "description"],
  rangeFields: { createdAt: dateTime, updatedAt: dateTime, dueDate: dateTime },
  orderFields: [
    "status",
    "department",
    "title",
    "createdAt",
    "updatedAt",
    "dueDate",
  ],
  defaultOrderBy: { createdAt: "asc" },
  defaultRows: 20,
  maxRows: 100,
};

const clientTaskListDefinition: ListQueryDefinition = {
  filterFields: { status: taskStatus },
  searchFields: ["title", "description"],
  rangeFields: { createdAt: dateTime, updatedAt: dateTime, dueDate: dateTime },
  orderFields: ["status", "title", "createdAt", "updatedAt", "dueDate"],
  defaultOrderBy: { createdAt: "asc" },
  defaultRows: 20,
  maxRows: 100,
};

const memberListDefinition: ListQueryDefinition = {
  filterFields: { "user.department": taskDepartment },
  searchFields: ["user.name", "user.email"],
  rangeFields: { createdAt: dateTime },
  orderFields: ["user.name", "user.email", "user.department", "createdAt"],
  defaultOrderBy: { user: { name: "asc" } },
};

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use("*", authMiddleware);

projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const listQuery = buildListQuery(c.req.query(), projectListDefinition);
  const scopeWhere: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(user.role === "INTERNAL_TEAM"
      ? { members: { some: { userId: user.id, deletedAt: null } } }
      : user.role === "CLIENT_GUEST"
        ? { id: user.clientProjectId ?? "__none__" }
        : {}),
  };
  const where: Prisma.ProjectWhereInput = {
    AND: [scopeWhere, listQuery.where as Prisma.ProjectWhereInput],
  };

  const [projects, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      orderBy: listQuery.orderBy as Prisma.ProjectOrderByWithRelationInput,
      skip: listQuery.skip,
      take: listQuery.take,
    }),
    prisma.project.count({ where }),
  ]);
  const taskCounts = await prisma.task.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projects.map(({ id }) => id) }, deletedAt: null },
    _count: { _all: true },
  });
  const data = projects.map((project) => {
    const count = (status: "TODO" | "IN_PROGRESS" | "DONE") =>
      taskCounts.find(
        (entry) => entry.projectId === project.id && entry.status === status,
      )?._count._all ?? 0;
    const todo = count("TODO");
    const inProgress = count("IN_PROGRESS");
    const done = count("DONE");
    const taskTotal = todo + inProgress + done;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      metrics: {
        total: taskTotal,
        todo,
        inProgress,
        done,
        completionPercentage:
          taskTotal === 0 ? 0 : Math.round((done / taskTotal) * 100),
      },
      ...(user.role === "PRODUCT_MANAGER"
        ? { accessCode: project.accessCode }
        : {}),
    };
  });
  return ok(c, data, paginationMeta(listQuery, total));
});

projectRoutes.post("/", zValidator("json", createProjectSchema), async (c) => {
  const user = c.get("user");
  assertPm(user);
  const input = c.req.valid("json");
  const duplicate = await prisma.project.findUnique({
    where: { accessCode: input.accessCode },
  });
  if (duplicate)
    throw new AppError(
      409,
      "ACCESS_CODE_EXISTS",
      "Kode akses sudah digunakan.",
    );
  return ok(c, await prisma.project.create({ data: input }));
});

projectRoutes.patch(
  "/:projectId",
  zValidator("json", updateProjectSchema),
  async (c) => {
    const user = c.get("user");
    assertPm(user);
    const projectId = c.req.param("projectId");
    await assertProjectAccess(user, projectId);
    const input = c.req.valid("json");
    if (input.accessCode) {
      const duplicate = await prisma.project.findFirst({
        where: { accessCode: input.accessCode, id: { not: projectId } },
      });
      if (duplicate)
        throw new AppError(
          409,
          "ACCESS_CODE_EXISTS",
          "Kode akses sudah digunakan.",
        );
    }
    const updateData: Prisma.ProjectUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.accessCode !== undefined
        ? { accessCode: input.accessCode }
        : {}),
    };
    return ok(
      c,
      await prisma.project.update({
        where: { id: projectId },
        data: updateData,
      }),
    );
  },
);

projectRoutes.delete("/:projectId", async (c) => {
  const user = c.get("user");
  assertPm(user);
  const projectId = c.req.param("projectId");
  await assertProjectAccess(user, projectId);
  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });
  return ok(c, { deleted: true });
});

projectRoutes.get("/:projectId/tasks", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("projectId");
  await assertProjectAccess(user, projectId);
  const listQuery = buildListQuery(
    c.req.query(),
    user.role === "CLIENT_GUEST"
      ? clientTaskListDefinition
      : internalTaskListDefinition,
  );
  const scopeWhere: Prisma.TaskWhereInput = {
    projectId,
    deletedAt: null,
    ...(user.role === "CLIENT_GUEST" ? { clientVisible: true } : {}),
  };
  const where: Prisma.TaskWhereInput = {
    AND: [scopeWhere, listQuery.where as Prisma.TaskWhereInput],
  };
  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: listQuery.orderBy as Prisma.TaskOrderByWithRelationInput,
      skip: listQuery.skip,
      take: listQuery.take,
    }),
    prisma.task.count({ where }),
  ]);

  return ok(
    c,
    tasks.map((task) => serializeTask(task, user)),
    paginationMeta(listQuery, total),
  );
});

projectRoutes.get("/:projectId/members", async (c) => {
  const user = c.get("user");
  if (user.role === "CLIENT_GUEST")
    throw new AppError(403, "FORBIDDEN", "Data internal tidak tersedia.");
  const projectId = c.req.param("projectId");
  await assertProjectAccess(user, projectId);
  const listQuery = buildListQuery(c.req.query(), memberListDefinition);
  const where: Prisma.ProjectMemberWhereInput = {
    AND: [
      { projectId, deletedAt: null, user: { deletedAt: null } },
      listQuery.where as Prisma.ProjectMemberWhereInput,
    ],
  };
  const [members, total] = await prisma.$transaction([
    prisma.projectMember.findMany({
      where,
      orderBy:
        listQuery.orderBy as Prisma.ProjectMemberOrderByWithRelationInput,
      skip: listQuery.skip,
      take: listQuery.take,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            department: true,
            avatarUrl: true,
          },
        },
      },
    }),
    prisma.projectMember.count({ where }),
  ]);
  return ok(
    c,
    members.map(({ user: member }) => member),
    paginationMeta(listQuery, total),
  );
});

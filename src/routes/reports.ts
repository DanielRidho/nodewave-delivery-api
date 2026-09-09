import { Hono } from "hono";
import { forbidden } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { authMiddleware } from "../middleware/auth";
import { assertProjectAccess } from "../services/access";
import type { AppEnv } from "../types";

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", authMiddleware);

reportRoutes.get("/:projectId/daily-standup", async (c) => {
  const user = c.get("user");
  if (user.role === "CLIENT_GUEST")
    throw forbidden("Standup merupakan data internal.");
  const projectId = c.req.param("projectId");
  await assertProjectAccess(user, projectId);

  const now = new Date();
  const startToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
  const completed = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: startYesterday, lt: startToday },
      changedColumn: "status",
      newValue: { equals: "DONE" },
      task: { projectId, deletedAt: null },
    },
    include: { task: { select: { id: true, title: true, department: true } } },
  });
  const candidates = await prisma.task.findMany({
    where: { projectId, status: "TODO", deletedAt: null },
    include: {
      prerequisites: {
        where: {
          deletedAt: null,
          prerequisiteTask: { status: { not: "DONE" }, deletedAt: null },
        },
        include: { prerequisiteTask: { select: { id: true, title: true } } },
      },
    },
  });
  const blocked = candidates.filter((task) => task.prerequisites.length > 0);
  const departments = ["PRODUCT", "UI_UX", "FRONTEND", "BACKEND"] as const;

  return ok(c, {
    period: { from: startYesterday, to: startToday },
    departments: departments.map((department) => ({
      department,
      completedYesterday: completed
        .filter((entry) => entry.task.department === department)
        .map((entry) => ({ id: entry.task.id, title: entry.task.title })),
      blockedToday: blocked
        .filter((task) => task.department === department)
        .map((task) => ({
          id: task.id,
          title: task.title,
          blockedBy: task.prerequisites.map(
            ({ prerequisiteTask }) => prerequisiteTask,
          ),
        })),
    })),
  });
});

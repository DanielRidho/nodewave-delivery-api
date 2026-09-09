import { forbidden, notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../types";
import { canReadProject } from "./policy";

export const assertProjectAccess = async (
  user: AuthUser,
  projectId: string,
) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  if (!project) throw notFound("Project");

  const membership =
    user.role === "INTERNAL_TEAM"
      ? await prisma.projectMember.findFirst({
          where: { projectId, userId: user.id, deletedAt: null },
          select: { id: true },
        })
      : null;

  if (!canReadProject(user, projectId, Boolean(membership))) {
    if (user.role === "CLIENT_GUEST") throw notFound("Project");
    throw forbidden();
  }
};

export const assertPm = (user: AuthUser) => {
  if (user.role !== "PRODUCT_MANAGER") {
    throw forbidden("Hanya Product Manager yang dapat melakukan aksi ini.");
  }
};

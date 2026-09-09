import type { MiddlewareHandler } from "hono";
import jwt from "jsonwebtoken";
import { env } from "../config";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { AppEnv } from "../types";

type TokenPayload = jwt.JwtPayload & { sub: string; sid: string };

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Silakan login terlebih dahulu.",
    );

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    throw new AppError(
      401,
      "INVALID_TOKEN",
      "Sesi tidak valid atau sudah kedaluwarsa.",
    );
  }

  const session = await prisma.session.findFirst({
    where: {
      id: payload.sid,
      userId: payload.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { deletedAt: null },
    },
    include: { user: true },
  });

  if (!session)
    throw new AppError(401, "SESSION_REVOKED", "Sesi sudah tidak aktif.");

  c.set("sessionId", session.id);
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    department: session.user.department,
    clientProjectId: session.user.clientProjectId,
  });
  await next();
};

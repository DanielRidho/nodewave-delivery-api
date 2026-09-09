import { zValidator } from "@hono/zod-validator";
import { compare, hash } from "bcryptjs";
import { Hono } from "hono";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
});

const registerSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(80),
  projectAccessCode: z.string().trim().min(4),
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const input = c.req.valid("json");
  const project = await prisma.project.findFirst({
    where: { accessCode: input.projectAccessCode, deletedAt: null },
  });
  if (!project)
    throw new AppError(
      400,
      "INVALID_ACCESS_CODE",
      "Kode akses project tidak valid.",
    );

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing)
    throw new AppError(409, "EMAIL_EXISTS", "Email sudah terdaftar.");

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hash(input.password, 12),
      role: "CLIENT_GUEST",
      department: "CLIENT",
      clientProjectId: project.id,
    },
  });

  return ok(
    c,
    { id: user.id, email: user.email, name: user.name },
    { message: "Registrasi berhasil." },
  );
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const input = c.req.valid("json");
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  });
  if (!user || !(await compare(input.password, user.passwordHash))) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email atau password salah.",
    );
  }

  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt },
  });
  const token = jwt.sign({ sid: session.id }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: 8 * 60 * 60,
  });

  return ok(c, {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      clientProjectId: user.clientProjectId,
    },
  });
});

authRoutes.use("/me", authMiddleware);
authRoutes.get("/me", (c) => ok(c, c.get("user")));

authRoutes.use("/logout", authMiddleware);
authRoutes.post("/logout", async (c) => {
  await prisma.session.update({
    where: { id: c.get("sessionId") },
    data: { revokedAt: new Date() },
  });
  return ok(c, { loggedOut: true });
});

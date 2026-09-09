import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { env } from "./config";
import { AppError } from "./lib/errors";
import { prisma } from "./lib/prisma";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { reportRoutes } from "./routes/reports";
import { taskRoutes } from "./routes/tasks";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: env.FRONTEND_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/", (c) => c.json({ name: "NodeWave Delivery API", status: "ok" }));
app.get("/health", async (c) => {
  await prisma.$queryRaw`SELECT 1`;
  return c.json({
    status: "healthy",
    database: "connected",
    timestamp: new Date().toISOString(),
  });
});
app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/reports", reportRoutes);

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_FOUND", message: "Route tidak ditemukan." },
    },
    404,
  ),
);

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      error.status as 400,
    );
  }
  if (error instanceof ZodError) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input tidak valid.",
          details: error.issues,
        },
      },
      422,
    );
  }
  console.error(error);
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Terjadi kesalahan pada server.",
      },
    },
    500,
  );
});

import type { Context } from "hono";

export const ok = <T>(c: Context, data: T, meta?: Record<string, unknown>) =>
  c.json({ success: true, data, ...(meta ? { meta } : {}) });

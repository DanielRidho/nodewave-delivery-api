export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (entity = "Data") =>
  new AppError(404, "NOT_FOUND", `${entity} tidak ditemukan.`);

export const forbidden = (
  message = "Kamu tidak memiliki akses untuk aksi ini.",
) => new AppError(403, "FORBIDDEN", message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "VERSION_CONFLICT", message, details);

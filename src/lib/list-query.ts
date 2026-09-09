import {
  BuildQueryFilter,
  type FilteringQuery,
  type PrismaOrderBy,
  type PrismaWhereCondition,
} from "@nodewave/prisma-ezfilter";
import { z } from "zod";
import { AppError } from "./errors";

type QueryScalar = string | number | boolean;
type QueryValue = QueryScalar | QueryScalar[];
type QueryValueSchema = z.ZodType<QueryScalar>;
type RangeValueSchema = z.ZodType<string | number>;

export type ListQueryDefinition = {
  filterFields?: Record<string, QueryValueSchema>;
  searchFields?: readonly string[];
  rangeFields?: Record<string, RangeValueSchema>;
  orderFields?: readonly string[];
  defaultOrderBy: PrismaOrderBy;
  defaultRows?: number;
  maxRows?: number;
};

export type ParsedListQuery = {
  where: PrismaWhereCondition;
  orderBy: PrismaOrderBy | PrismaOrderBy[];
  skip: number;
  take: number;
  page: number;
  rows: number;
};

const rawQuerySchema = z
  .object({
    filters: z.string().optional(),
    searchFilters: z.string().optional(),
    rangedFilters: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    rows: z.coerce.number().int().positive().optional(),
    orderKey: z.string().trim().min(1).optional(),
    orderRule: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

const parseJson = (raw: string, parameter: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(
      400,
      "INVALID_QUERY",
      `${parameter} harus berupa JSON yang valid.`,
    );
  }
};

const parseObject = (raw: string, parameter: string) => {
  const result = z
    .record(z.string(), z.unknown())
    .safeParse(parseJson(raw, parameter));
  if (!result.success) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      `${parameter} harus berupa object JSON.`,
      result.error.issues,
    );
  }
  return result.data;
};

const parseFilters = (
  raw: string | undefined,
  fields: Record<string, QueryValueSchema>,
) => {
  if (!raw) return undefined;
  const input = parseObject(raw, "filters");
  const output: Record<string, QueryValue> = {};

  for (const [key, value] of Object.entries(input)) {
    const schema = fields[key];
    if (!schema) {
      throw new AppError(
        400,
        "INVALID_QUERY_FIELD",
        `Field '${key}' tidak dapat dipakai pada filters.`,
      );
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new AppError(
          400,
          "INVALID_QUERY",
          `Array filters untuk '${key}' tidak boleh kosong.`,
        );
      }
      const parsedValues: QueryScalar[] = [];
      for (const item of value) {
        const parsed = schema.safeParse(item);
        if (!parsed.success) {
          throw new AppError(
            400,
            "INVALID_QUERY_VALUE",
            `Nilai filters untuk '${key}' tidak valid.`,
            parsed.error.issues,
          );
        }
        parsedValues.push(parsed.data);
      }
      output[key] = parsedValues;
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError(
        400,
        "INVALID_QUERY_VALUE",
        `Nilai filters untuk '${key}' tidak valid.`,
        parsed.error.issues,
      );
    }
    output[key] = parsed.data;
  }
  return output;
};

const parseSearchFilters = (
  raw: string | undefined,
  allowedFields: readonly string[],
) => {
  if (!raw) return undefined;
  const input = parseObject(raw, "searchFilters");
  const output: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!allowedFields.includes(key)) {
      throw new AppError(
        400,
        "INVALID_QUERY_FIELD",
        `Field '${key}' tidak dapat dipakai pada searchFilters.`,
      );
    }
    const parsed = z
      .union([z.string(), z.array(z.string()).min(1)])
      .safeParse(value);
    if (!parsed.success) {
      throw new AppError(
        400,
        "INVALID_QUERY_VALUE",
        `Nilai searchFilters untuk '${key}' harus string atau array string.`,
        parsed.error.issues,
      );
    }
    output[key] = parsed.data;
  }
  return output;
};

const parseRangedFilters = (
  raw: string | undefined,
  fields: Record<string, RangeValueSchema>,
) => {
  if (!raw) return undefined;
  const input = z
    .array(
      z
        .object({ key: z.string(), start: z.unknown(), end: z.unknown() })
        .strict(),
    )
    .safeParse(parseJson(raw, "rangedFilters"));
  if (!input.success) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      "rangedFilters harus berupa array berisi key, start, dan end.",
      input.error.issues,
    );
  }

  return input.data.map((range) => {
    const schema = fields[range.key];
    if (!schema) {
      throw new AppError(
        400,
        "INVALID_QUERY_FIELD",
        `Field '${range.key}' tidak dapat dipakai pada rangedFilters.`,
      );
    }
    const start = schema.safeParse(range.start);
    const end = schema.safeParse(range.end);
    if (!start.success || !end.success) {
      throw new AppError(
        400,
        "INVALID_QUERY_VALUE",
        `Batas rangedFilters untuk '${range.key}' tidak valid.`,
        [
          ...(!start.success ? start.error.issues : []),
          ...(!end.success ? end.error.issues : []),
        ],
      );
    }
    const startComparable =
      typeof start.data === "number"
        ? start.data
        : new Date(start.data).getTime();
    const endComparable =
      typeof end.data === "number" ? end.data : new Date(end.data).getTime();
    if (startComparable > endComparable) {
      throw new AppError(
        400,
        "INVALID_QUERY_RANGE",
        `Nilai start untuk '${range.key}' tidak boleh melebihi end.`,
      );
    }
    return { key: range.key, start: start.data, end: end.data };
  });
};

const relationNames = (fields: string[]) =>
  Array.from(
    new Set(
      fields.flatMap((field) => {
        const parts = field.split(".");
        return parts.slice(0, -1);
      }),
    ),
  );

export const buildListQuery = (
  params: Record<string, string>,
  definition: ListQueryDefinition,
): ParsedListQuery => {
  const raw = rawQuerySchema.safeParse(params);
  if (!raw.success) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      "Parameter query tidak valid.",
      raw.error.issues,
    );
  }

  const maxRows = definition.maxRows ?? 100;
  const rows = raw.data.rows ?? definition.defaultRows ?? 20;
  if (rows > maxRows) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      `rows tidak boleh melebihi ${maxRows}.`,
    );
  }
  if (raw.data.orderRule && !raw.data.orderKey) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      "orderRule hanya dapat digunakan bersama orderKey.",
    );
  }

  const filterFields = definition.filterFields ?? {};
  const searchFields = definition.searchFields ?? [];
  const rangeFields = definition.rangeFields ?? {};
  const orderFields = definition.orderFields ?? [];
  if (raw.data.orderKey && !orderFields.includes(raw.data.orderKey)) {
    throw new AppError(
      400,
      "INVALID_QUERY_FIELD",
      `Field '${raw.data.orderKey}' tidak dapat dipakai pada orderKey.`,
    );
  }

  const allowedFields = Array.from(
    new Set([
      ...Object.keys(filterFields),
      ...searchFields,
      ...Object.keys(rangeFields),
      ...orderFields,
    ]),
  );
  const filters = parseFilters(raw.data.filters, filterFields);
  const searchFilters = parseSearchFilters(
    raw.data.searchFilters,
    searchFields,
  );
  const rangedFilters = parseRangedFilters(raw.data.rangedFilters, rangeFields);
  const query: FilteringQuery = {
    page: raw.data.page ?? 1,
    rows,
    ...(filters ? { filters } : {}),
    ...(searchFilters ? { searchFilters } : {}),
    ...(rangedFilters ? { rangedFilters } : {}),
    ...(raw.data.orderKey ? { orderKey: raw.data.orderKey } : {}),
    ...(raw.data.orderRule ? { orderRule: raw.data.orderRule } : {}),
  };
  const builder = new BuildQueryFilter({
    allowedFields,
    allowedRelations: relationNames(allowedFields),
    maxPageSize: maxRows,
    defaultPageSize: definition.defaultRows ?? 20,
    defaultSearchMode: "insensitive",
  });
  const built = builder.build(query);
  const validationMessages = [
    ...built.validation.errors,
    ...built.validation.warnings,
  ];
  if (!built.validation.isValid || validationMessages.length > 0) {
    throw new AppError(
      400,
      "INVALID_QUERY",
      "Query filter tidak diizinkan.",
      validationMessages,
    );
  }

  return {
    where: built.query.where,
    orderBy: raw.data.orderKey
      ? (built.query.orderBy ?? definition.defaultOrderBy)
      : definition.defaultOrderBy,
    skip: built.query.skip,
    take: built.query.take,
    page: raw.data.page ?? 1,
    rows,
  };
};

export const paginationMeta = (query: ParsedListQuery, total: number) => ({
  pagination: {
    page: query.page,
    rows: query.rows,
    total,
    totalPages: Math.ceil(total / query.rows),
  },
});

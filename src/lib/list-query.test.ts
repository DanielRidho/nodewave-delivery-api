import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { buildListQuery, type ListQueryDefinition } from "./list-query";

const foodListDefinition: ListQueryDefinition = {
  filterFields: {
    category: z.enum(["Local", "Foreign"]),
    origin: z.string(),
    price: z.number(),
  },
  searchFields: ["name", "origin"],
  rangeFields: { price: z.number() },
  orderFields: ["name", "price"],
  defaultOrderBy: { name: "asc" },
};

describe("standard filtering, pagination, and searching contract", () => {
  test("combines exact filters with AND and array values with OR", () => {
    const query = buildListQuery(
      {
        filters: JSON.stringify({
          category: "Foreign",
          origin: ["Germany", "Italy"],
        }),
      },
      foodListDefinition,
    );

    expect(query.where).toEqual({
      AND: [
        { category: "Foreign" },
        { OR: [{ origin: "Germany" }, { origin: "Italy" }] },
      ],
    });
  });

  test("searches multiple same-type columns with contains and OR", () => {
    const query = buildListQuery(
      {
        searchFilters: JSON.stringify({ origin: "Ita", name: "Ita" }),
      },
      foodListDefinition,
    );

    expect(query.where).toEqual({
      AND: [
        {
          OR: [
            { origin: { contains: "Ita", mode: "insensitive" } },
            { name: { contains: "Ita", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  test("combines exact filtering and partial searching in one request", () => {
    const query = buildListQuery(
      {
        filters: JSON.stringify({ category: "Foreign" }),
        searchFilters: JSON.stringify({ name: "Soup" }),
      },
      foodListDefinition,
    );

    expect(query.where).toEqual({
      AND: [
        { category: "Foreign" },
        { name: { contains: "Soup", mode: "insensitive" } },
      ],
    });
  });

  test("supports inclusive range, ordering, and pagination together", () => {
    const query = buildListQuery(
      {
        rangedFilters: JSON.stringify([
          { key: "price", start: 50_000, end: 60_000 },
        ]),
        orderKey: "price",
        orderRule: "desc",
        page: "2",
        rows: "25",
      },
      foodListDefinition,
    );

    expect(query.where).toEqual({
      AND: [{ price: { gte: 50_000, lte: 60_000 } }],
    });
    expect(query.orderBy).toEqual({ price: "desc" });
    expect(query).toMatchObject({ page: 2, rows: 25, take: 25, skip: 25 });
  });

  test("honors rows when page is omitted by defaulting to page one", () => {
    const query = buildListQuery({ rows: "30" }, foodListDefinition);
    expect(query).toMatchObject({ page: 1, rows: 30, take: 30, skip: 0 });
  });

  test.each([
    [{ filters: "{" }, "INVALID_QUERY"],
    [
      { filters: JSON.stringify({ passwordHash: "secret" }) },
      "INVALID_QUERY_FIELD",
    ],
    [
      { searchFilters: JSON.stringify({ department: "Frontend" }) },
      "INVALID_QUERY_FIELD",
    ],
    [
      {
        rangedFilters: JSON.stringify([
          { key: "internalCost", start: 1, end: 2 },
        ]),
      },
      "INVALID_QUERY_FIELD",
    ],
    [{ orderKey: "passwordHash" }, "INVALID_QUERY_FIELD"],
    [{ page: "0" }, "INVALID_QUERY"],
    [{ rows: "101" }, "INVALID_QUERY"],
  ])("rejects malformed or unsafe query %#", (params, expectedCode) => {
    try {
      buildListQuery(params, foodListDefinition);
      throw new Error("Expected query parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(expectedCode);
    }
  });
});

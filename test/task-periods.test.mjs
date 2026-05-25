import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeTaskPeriodKey,
  getIsoWeekCount,
  isValidTaskPeriodKey,
  normalizeTaskPeriodType,
  parseTaskPeriodKey,
  validateTaskPeriod,
} from "../src/lib/task-periods.mjs";

test("validates and normalizes periodType values", () => {
  assert.equal(normalizeTaskPeriodType(" day "), "day");
  assert.equal(normalizeTaskPeriodType("WEEK"), "week");
  assert.equal(normalizeTaskPeriodType("month"), "month");

  assert.throws(
    () => normalizeTaskPeriodType("quarter"),
    /periodType must be one of: day, week, month \(received "quarter"\)/,
  );
  assert.throws(
    () => normalizeTaskPeriodType(""),
    /periodType is required; expected one of: day, week, month/,
  );
});

test("parses and canonicalizes valid day period keys", () => {
  assert.deepEqual(parseTaskPeriodKey("day", "2026-01-01"), {
    periodType: "day",
    periodKey: "2026-01-01",
    year: 2026,
    month: 1,
    day: 1,
  });
  assert.equal(canonicalizeTaskPeriodKey("day", " 2024-02-29 "), "2024-02-29");
  assert.equal(canonicalizeTaskPeriodKey("day", "2026-12-31"), "2026-12-31");
});

test("rejects malformed and impossible day period keys", () => {
  for (const value of ["2026-1-01", "2026-01-1", "2026/01/01"]) {
    assert.throws(
      () => parseTaskPeriodKey("day", value),
      /periodKey for day must use YYYY-MM-DD/,
    );
  }

  for (const value of ["2023-02-29", "2026-00-10", "2026-13-01", "2026-04-31"]) {
    assert.throws(
      () => parseTaskPeriodKey("day", value),
      /periodKey for day must be a valid calendar date/,
    );
  }
});

test("parses ISO week period keys and enforces week-year boundaries", () => {
  assert.equal(getIsoWeekCount(2020), 53);
  assert.equal(getIsoWeekCount(2021), 52);
  assert.deepEqual(parseTaskPeriodKey("week", "2020-W53"), {
    periodType: "week",
    periodKey: "2020-W53",
    year: 2020,
    week: 53,
    isoWeekCount: 53,
    startDate: "2020-12-28",
    endDate: "2021-01-03",
  });
  assert.equal(canonicalizeTaskPeriodKey("week", "2026-w09"), "2026-W09");
  assert.equal(parseTaskPeriodKey("week", "2026-W01").startDate, "2025-12-29");
});

test("rejects malformed and out-of-range week period keys", () => {
  for (const value of ["2026-W1", "2026-01", "2026-W001", "2026/Q01"]) {
    assert.throws(
      () => parseTaskPeriodKey("week", value),
      /periodKey for week must use YYYY-Www/,
    );
  }

  for (const value of ["2026-W00", "2026-W54"]) {
    assert.throws(
      () => parseTaskPeriodKey("week", value),
      /periodKey for week must use an ISO week number between 01 and 53/,
    );
  }

  assert.throws(
    () => parseTaskPeriodKey("week", "2021-W53"),
    /periodKey for week is invalid: 2021 has 52 ISO weeks/,
  );
});

test("parses valid month period keys and rejects invalid month boundaries", () => {
  assert.deepEqual(parseTaskPeriodKey("month", "2026-01"), {
    periodType: "month",
    periodKey: "2026-01",
    year: 2026,
    month: 1,
  });
  assert.equal(canonicalizeTaskPeriodKey("month", " 2026-12 "), "2026-12");

  for (const value of ["2026-1", "2026/01", "2026-001"]) {
    assert.throws(
      () => parseTaskPeriodKey("month", value),
      /periodKey for month must use YYYY-MM/,
    );
  }

  for (const value of ["2026-00", "2026-13"]) {
    assert.throws(
      () => parseTaskPeriodKey("month", value),
      /periodKey for month must use a month between 01 and 12/,
    );
  }
});

test("validates whole task period inputs", () => {
  assert.deepEqual(validateTaskPeriod({ periodType: "WEEK", periodKey: "2020-w53" }), {
    periodType: "week",
    periodKey: "2020-W53",
    parsedKey: {
      periodType: "week",
      periodKey: "2020-W53",
      year: 2020,
      week: 53,
      isoWeekCount: 53,
      startDate: "2020-12-28",
      endDate: "2021-01-03",
    },
  });
  assert.equal(isValidTaskPeriodKey("month", "2026-05"), true);
  assert.equal(isValidTaskPeriodKey("month", "2026-13"), false);
});

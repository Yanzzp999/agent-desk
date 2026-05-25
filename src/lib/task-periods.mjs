export const TASK_PERIOD_TYPES = Object.freeze(["day", "week", "month"]);
export const TASK_PERIOD_KEY_FORMATS = Object.freeze({
  day: "YYYY-MM-DD",
  week: "YYYY-Www",
  month: "YYYY-MM",
});

const TASK_PERIOD_TYPE_SET = new Set(TASK_PERIOD_TYPES);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export function normalizeTaskPeriodType(value) {
  const periodType = normalizeString(value).toLowerCase();
  if (!periodType) {
    throw new Error(`periodType is required; expected one of: ${TASK_PERIOD_TYPES.join(", ")}`);
  }
  if (!TASK_PERIOD_TYPE_SET.has(periodType)) {
    throw new Error(`periodType must be one of: ${TASK_PERIOD_TYPES.join(", ")} (received ${quote(value)})`);
  }
  return periodType;
}

export function parseTaskPeriodKey(periodTypeValue, periodKeyValue) {
  const periodType = normalizeTaskPeriodType(periodTypeValue);
  if (periodType === "day") {
    return parseDayPeriodKey(periodKeyValue);
  }
  if (periodType === "week") {
    return parseWeekPeriodKey(periodKeyValue);
  }
  return parseMonthPeriodKey(periodKeyValue);
}

export function canonicalizeTaskPeriodKey(periodType, periodKey) {
  return parseTaskPeriodKey(periodType, periodKey).periodKey;
}

export function validateTaskPeriod(input = {}) {
  const periodType = normalizeTaskPeriodType(input.periodType);
  const parsedKey = parseTaskPeriodKey(periodType, input.periodKey);
  return {
    periodType,
    periodKey: parsedKey.periodKey,
    parsedKey,
  };
}

export function isValidTaskPeriodKey(periodType, periodKey) {
  try {
    parseTaskPeriodKey(periodType, periodKey);
    return true;
  } catch {
    return false;
  }
}

export function getIsoWeekCount(yearValue) {
  const year = normalizeYear(yearValue, "ISO week year");
  const jan1 = utcDate(year, 0, 1).getUTCDay();
  return jan1 === 4 || (isLeapYear(year) && jan1 === 3) ? 53 : 52;
}

function parseDayPeriodKey(value) {
  const raw = normalizeString(value);
  if (!raw) {
    throw new Error(`periodKey is required for periodType=day; expected ${TASK_PERIOD_KEY_FORMATS.day}`);
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`periodKey for day must use ${TASK_PERIOD_KEY_FORMATS.day} (received ${quote(raw)})`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    throw new Error(`periodKey for day must be a valid calendar date (received ${quote(raw)})`);
  }

  return {
    periodType: "day",
    periodKey: `${match[1]}-${match[2]}-${match[3]}`,
    year,
    month,
    day,
  };
}

function parseWeekPeriodKey(value) {
  const raw = normalizeString(value);
  if (!raw) {
    throw new Error(`periodKey is required for periodType=week; expected ${TASK_PERIOD_KEY_FORMATS.week}`);
  }
  const match = raw.match(/^(\d{4})-[Ww](\d{2})$/);
  if (!match) {
    throw new Error(`periodKey for week must use ${TASK_PERIOD_KEY_FORMATS.week} (received ${quote(raw)})`);
  }

  const yearText = match[1];
  const weekText = match[2];
  const year = Number(yearText);
  const week = Number(weekText);
  const isoWeekCount = getIsoWeekCount(year);
  if (week < 1 || week > 53) {
    throw new Error(`periodKey for week must use an ISO week number between 01 and 53 (received ${quote(raw)})`);
  }
  if (week > isoWeekCount) {
    throw new Error(
      `periodKey for week is invalid: ${yearText} has ${isoWeekCount} ISO weeks (received ${quote(raw)})`,
    );
  }

  const { startDate, endDate } = isoWeekDateRange(year, week);
  return {
    periodType: "week",
    periodKey: `${yearText}-W${weekText}`,
    year,
    week,
    isoWeekCount,
    startDate,
    endDate,
  };
}

function parseMonthPeriodKey(value) {
  const raw = normalizeString(value);
  if (!raw) {
    throw new Error(`periodKey is required for periodType=month; expected ${TASK_PERIOD_KEY_FORMATS.month}`);
  }
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`periodKey for month must use ${TASK_PERIOD_KEY_FORMATS.month} (received ${quote(raw)})`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`periodKey for month must use a month between 01 and 12 (received ${quote(raw)})`);
  }

  return {
    periodType: "month",
    periodKey: `${match[1]}-${match[2]}`,
    year,
    month,
  };
}

function normalizeYear(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new Error(`${label} must be a four-digit year between 0000 and 9999 (received ${quote(value)})`);
  }
  return year;
}

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = utcDate(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isoWeekDateRange(year, week) {
  const jan4 = utcDate(year, 0, 4);
  const jan4IsoDay = isoDayOfWeek(jan4);
  const weekOneMonday = new Date(jan4.getTime() - ((jan4IsoDay - 1) * MS_PER_DAY));
  const start = new Date(weekOneMonday.getTime() + ((week - 1) * MS_PER_WEEK));
  const end = new Date(start.getTime() + (6 * MS_PER_DAY));
  return {
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
  };
}

function utcDate(year, monthIndex, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function isoDayOfWeek(date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function formatUtcDate(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

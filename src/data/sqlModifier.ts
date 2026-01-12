/**
 * SQL Modifier utility functions
 *
 * Functions to modify SQL queries for log context queries.
 * Used to support infinite scrolling in SQL mode.
 */

import { findMainClausePosition, trimTrailingSemicolon } from './sqlUtils';

export interface ContextFilter {
  column: string;
  value: string;
}

/**
 * Adds a WHERE condition to the SQL query.
 * If WHERE exists, prepends the condition with AND.
 * If no WHERE, inserts before GROUP BY/ORDER BY/LIMIT or appends at end.
 */
export function addWhereCondition(sql: string, condition: string): string {
  if (!sql || !condition) {
    return sql;
  }

  const trimmedSql = trimTrailingSemicolon(sql);
  const wherePos = findMainClausePosition(trimmedSql, 'WHERE');

  if (wherePos !== -1) {
    // WHERE exists - insert condition right after WHERE keyword
    const insertPos = wherePos + 5; // length of 'WHERE'
    return trimmedSql.slice(0, insertPos) + ` ${condition} AND` + trimmedSql.slice(insertPos);
  }

  // No WHERE clause - find where to insert it
  const clausesToFind = ['GROUP BY', 'ORDER BY', 'LIMIT', 'SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(trimmedSql, clause);
    if (pos !== -1) {
      return trimmedSql.slice(0, pos) + `WHERE ${condition} ` + trimmedSql.slice(pos);
    }
  }

  // No subsequent clauses found - append WHERE at the end
  return trimmedSql + ` WHERE ${condition}`;
}

/**
 * Removes existing ORDER BY clause from SQL query.
 */
function removeOrderBy(sql: string): string {
  const orderByPos = findMainClausePosition(sql, 'ORDER BY');
  if (orderByPos === -1) {
    return sql;
  }

  // Find where ORDER BY ends (at LIMIT, SETTINGS, FORMAT, or end)
  const afterOrderBy = sql.slice(orderByPos);
  const clausesToFind = ['LIMIT', 'SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(afterOrderBy, clause);
    if (pos !== -1) {
      return sql.slice(0, orderByPos) + afterOrderBy.slice(pos);
    }
  }

  // ORDER BY is at the end
  return sql.slice(0, orderByPos).trim();
}

/**
 * Removes existing LIMIT clause from SQL query.
 */
function removeLimit(sql: string): string {
  const limitPos = findMainClausePosition(sql, 'LIMIT');
  if (limitPos === -1) {
    return sql;
  }

  // Find where LIMIT ends (at SETTINGS, FORMAT, or end)
  const afterLimit = sql.slice(limitPos);
  const clausesToFind = ['SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(afterLimit, clause);
    if (pos !== -1) {
      return sql.slice(0, limitPos) + afterLimit.slice(pos);
    }
  }

  // LIMIT is at the end - find end of LIMIT value
  const limitMatch = afterLimit.match(/^LIMIT\s+\d+(\s*,\s*\d+)?/i);
  if (limitMatch) {
    const remaining = afterLimit.slice(limitMatch[0].length).trim();
    return remaining ? sql.slice(0, limitPos).trimEnd() + ' ' + remaining : sql.slice(0, limitPos).trimEnd();
  }

  return sql.slice(0, limitPos).trim();
}

/**
 * Sets ORDER BY clause in SQL query, replacing any existing one.
 */
export function setOrderBy(sql: string, column: string, direction: 'ASC' | 'DESC'): string {
  if (!sql || !column) {
    return sql;
  }

  const trimmedSql = removeOrderBy(trimTrailingSemicolon(sql));
  const orderByClause = `ORDER BY "${column}" ${direction}`;

  // Find where to insert ORDER BY
  const clausesToFind = ['LIMIT', 'SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(trimmedSql, clause);
    if (pos !== -1) {
      return trimmedSql.slice(0, pos) + orderByClause + ' ' + trimmedSql.slice(pos);
    }
  }

  // Append at end
  return trimmedSql + ' ' + orderByClause;
}

/**
 * Sets LIMIT clause in SQL query, replacing any existing one.
 */
export function setLimit(sql: string, limit: number): string {
  if (!sql || limit <= 0) {
    return sql;
  }

  const trimmedSql = removeLimit(trimTrailingSemicolon(sql));
  const limitClause = `LIMIT ${limit}`;

  // Find where to insert LIMIT
  const clausesToFind = ['SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(trimmedSql, clause);
    if (pos !== -1) {
      return trimmedSql.slice(0, pos) + limitClause + ' ' + trimmedSql.slice(pos);
    }
  }

  // Append at end
  return trimmedSql + ' ' + limitClause;
}

/**
 * Builds a context query SQL from the original SQL for infinite scrolling.
 *
 * @param originalSql - The original SQL query
 * @param timeColumn - The time column name
 * @param timestamp - The timestamp value (as ClickHouse expression)
 * @param direction - 'forward' or 'backward'
 * @param limit - Number of rows to fetch
 * @param contextFilters - Additional context filters (e.g., service, pod)
 */
export function buildContextQuerySql(
  originalSql: string,
  timeColumn: string,
  timestamp: string,
  direction: 'forward' | 'backward',
  limit: number,
  contextFilters: ContextFilter[] = []
): string {
  if (!originalSql || !timeColumn) {
    return originalSql;
  }

  let sql = originalSql;

  // Add time filter
  const timeOperator = direction === 'forward' ? '>=' : '<=';
  const timeCondition = `"${timeColumn}" ${timeOperator} ${timestamp}`;
  sql = addWhereCondition(sql, timeCondition);

  // Add context filters
  for (const filter of contextFilters) {
    const condition = `"${filter.column}" = '${filter.value.replace(/'/g, "''")}'`;
    sql = addWhereCondition(sql, condition);
  }

  // Set ORDER BY
  const orderDirection = direction === 'forward' ? 'ASC' : 'DESC';
  sql = setOrderBy(sql, timeColumn, orderDirection);

  // Set LIMIT
  sql = setLimit(sql, limit);

  return sql;
}

/**
 * Checks if the SQL query has an ORDER BY clause in the main query.
 * Does not detect ORDER BY inside subqueries.
 */
export function hasOrderBy(sql: string): boolean {
  if (!sql) {
    return false;
  }
  return findMainClausePosition(sql, 'ORDER BY') !== -1;
}

/**
 * Checks if the SQL query is an aggregate query without GROUP BY.
 * Such queries return a single row and should not have ORDER BY injected.
 *
 * Detects common aggregate functions: count, sum, avg, min, max, any, uniq, etc.
 */
export function isAggregateQueryWithoutGroupBy(sql: string): boolean {
  if (!sql) {
    return false;
  }

  const upperSql = sql.toUpperCase();

  // If query has GROUP BY, ORDER BY is allowed (results have multiple rows)
  if (findMainClausePosition(sql, 'GROUP BY') !== -1) {
    return false;
  }

  // Check for common aggregate functions in SELECT clause
  // Pattern: function name followed by ( - handles count(), sum(col), avg(col), etc.
  const aggregateFunctions = [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'ANY',
    'ANYLAST',
    'ARGMIN',
    'ARGMAX',
    'UNIQ',
    'UNIQEXACT',
    'UNIQHLL12',
    'UNIQCOMBINED',
    'GROUPARRAY',
    'GROUPUNIQARRAY',
    'QUANTILE',
    'QUANTILES',
    'MEDIAN',
  ];

  // Extract SELECT clause (from SELECT to FROM)
  const selectMatch = upperSql.match(/SELECT\s+(.*?)\s+FROM/is);
  if (!selectMatch) {
    return false;
  }

  const selectClause = selectMatch[1];

  // Check if SELECT clause contains aggregate functions
  for (const fn of aggregateFunctions) {
    // Match function name followed by optional whitespace and opening paren
    const pattern = new RegExp(`\\b${fn}\\s*\\(`, 'i');
    if (pattern.test(selectClause)) {
      return true;
    }
  }

  return false;
}

/**
 * Injects ORDER BY clause into SQL query if it doesn't already have one.
 * If ORDER BY exists, returns the original SQL unchanged (preserves user intent).
 * Skips injection for aggregate queries without GROUP BY (e.g., SELECT count() FROM table).
 *
 * @param sql - The original SQL query
 * @param column - The column name to order by
 * @param direction - 'ASC' or 'DESC'
 */
export function injectOrderBy(sql: string, column: string, direction: 'ASC' | 'DESC'): string {
  if (!sql || !column) {
    return sql;
  }

  // Don't inject if ORDER BY already exists
  if (hasOrderBy(sql)) {
    return sql;
  }

  // Don't inject ORDER BY for aggregate queries without GROUP BY
  // These return a single row and ORDER BY would cause ClickHouse error
  if (isAggregateQueryWithoutGroupBy(sql)) {
    return sql;
  }

  const trimmedSql = trimTrailingSemicolon(sql);
  const orderByClause = `ORDER BY "${column}" ${direction}`;

  // Find where to insert ORDER BY (before LIMIT, SETTINGS, FORMAT)
  const clausesToFind = ['LIMIT', 'SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(trimmedSql, clause);
    if (pos !== -1) {
      return trimmedSql.slice(0, pos) + orderByClause + ' ' + trimmedSql.slice(pos);
    }
  }

  // Append at end
  return trimmedSql + ' ' + orderByClause;
}

// Export for testing
export const _testExports = {
  removeOrderBy,
  removeLimit,
  isAggregateQueryWithoutGroupBy,
};

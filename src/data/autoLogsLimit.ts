/**
 * Auto Logs Limit utility functions
 *
 * Automatically injects LIMIT clause into Logs SQL queries that don't have
 * explicit LIMIT, enabling efficient infinite scrolling in the logs panel.
 */

import { findMainClausePosition, trimTrailingSemicolon } from './sqlUtils';

/**
 * Checks if the SQL query already contains a LIMIT clause.
 * Handles subqueries by tracking parentheses depth.
 */
export function hasLimit(sql: string): boolean {
  if (!sql) {
    return false;
  }

  return findMainClausePosition(sql, 'LIMIT') !== -1;
}

/**
 * Injects LIMIT clause into SQL query if not present.
 *
 * @param sql - The SQL query string
 * @param limit - The limit value to inject
 * @returns Modified SQL with LIMIT injected, or original SQL if injection is not needed
 */
export function injectLimit(sql: string, limit: number): string {
  if (!sql || limit <= 0) {
    return sql;
  }

  // Skip if LIMIT already exists
  if (hasLimit(sql)) {
    return sql;
  }

  // Skip if query doesn't look like a SELECT statement
  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    return sql;
  }

  // Remove trailing semicolon for consistent injection
  const trimmedSql = trimTrailingSemicolon(sql);

  return appendLimitClause(trimmedSql, limit);
}

/**
 * Appends a LIMIT clause to the end of a SQL query.
 * Inserts before SETTINGS or FORMAT if present.
 */
function appendLimitClause(sql: string, limit: number): string {
  const limitClause = `LIMIT ${limit}`;

  // Look for SETTINGS or FORMAT clauses that should come after LIMIT
  const clausesToFind = ['SETTINGS', 'FORMAT'];

  for (const clause of clausesToFind) {
    const pos = findMainClausePosition(sql, clause);
    if (pos !== -1) {
      return sql.slice(0, pos) + `${limitClause} ` + sql.slice(pos);
    }
  }

  // No subsequent clauses found - append LIMIT at the end
  return sql + ` ${limitClause}`;
}

// Export for testing
export const _testExports = {
  appendLimitClause,
};

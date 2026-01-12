import {
  addWhereCondition,
  setOrderBy,
  setLimit,
  buildContextQuerySql,
  hasOrderBy,
  injectOrderBy,
  _testExports,
} from './sqlModifier';
import { findMainClausePosition } from './sqlUtils';

const { removeOrderBy, removeLimit } = _testExports;

describe('addWhereCondition', () => {
  it('adds WHERE when none exists', () => {
    const sql = 'SELECT * FROM table';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT * FROM table WHERE x = 1');
  });

  it('prepends to existing WHERE', () => {
    const sql = 'SELECT * FROM table WHERE y = 2';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT * FROM table WHERE x = 1 AND y = 2');
  });

  it('inserts before GROUP BY when no WHERE', () => {
    const sql = 'SELECT count(*) FROM table GROUP BY status';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT count(*) FROM table WHERE x = 1 GROUP BY status');
  });

  it('inserts before ORDER BY when no WHERE', () => {
    const sql = 'SELECT * FROM table ORDER BY ts';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT * FROM table WHERE x = 1 ORDER BY ts');
  });

  it('inserts before LIMIT when no WHERE', () => {
    const sql = 'SELECT * FROM table LIMIT 100';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT * FROM table WHERE x = 1 LIMIT 100');
  });

  it('removes trailing semicolon', () => {
    const sql = 'SELECT * FROM table;';
    expect(addWhereCondition(sql, 'x = 1')).toBe('SELECT * FROM table WHERE x = 1');
  });

  it('handles empty condition', () => {
    const sql = 'SELECT * FROM table';
    expect(addWhereCondition(sql, '')).toBe(sql);
  });
});

describe('setOrderBy', () => {
  it('adds ORDER BY when none exists', () => {
    const sql = 'SELECT * FROM table';
    expect(setOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC');
  });

  it('replaces existing ORDER BY', () => {
    const sql = 'SELECT * FROM table ORDER BY old_col ASC';
    expect(setOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC');
  });

  it('inserts before LIMIT', () => {
    const sql = 'SELECT * FROM table LIMIT 100';
    expect(setOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC LIMIT 100');
  });

  it('replaces ORDER BY and keeps LIMIT', () => {
    const sql = 'SELECT * FROM table ORDER BY old ASC LIMIT 100';
    expect(setOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC LIMIT 100');
  });

  it('inserts before SETTINGS', () => {
    const sql = 'SELECT * FROM table SETTINGS max_execution_time=60';
    expect(setOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC SETTINGS max_execution_time=60');
  });
});

describe('setLimit', () => {
  it('adds LIMIT when none exists', () => {
    const sql = 'SELECT * FROM table';
    expect(setLimit(sql, 100)).toBe('SELECT * FROM table LIMIT 100');
  });

  it('replaces existing LIMIT', () => {
    const sql = 'SELECT * FROM table LIMIT 50';
    expect(setLimit(sql, 100)).toBe('SELECT * FROM table LIMIT 100');
  });

  it('keeps ORDER BY when replacing LIMIT', () => {
    const sql = 'SELECT * FROM table ORDER BY ts DESC LIMIT 50';
    expect(setLimit(sql, 100)).toBe('SELECT * FROM table ORDER BY ts DESC LIMIT 100');
  });

  it('inserts before SETTINGS', () => {
    const sql = 'SELECT * FROM table SETTINGS x=1';
    expect(setLimit(sql, 100)).toBe('SELECT * FROM table LIMIT 100 SETTINGS x=1');
  });

  it('returns original when limit is 0', () => {
    const sql = 'SELECT * FROM table';
    expect(setLimit(sql, 0)).toBe(sql);
  });
});

describe('buildContextQuerySql', () => {
  const baseSql = "SELECT timestamp, level, message FROM logs WHERE level = 'ERROR'";

  it('builds forward context query', () => {
    const result = buildContextQuerySql(baseSql, 'timestamp', 'fromUnixTimestamp64Nano(123)', 'forward', 10, []);

    expect(result).toContain('"timestamp" >= fromUnixTimestamp64Nano(123)');
    expect(result).toContain('ORDER BY "timestamp" ASC');
    expect(result).toContain('LIMIT 10');
  });

  it('builds backward context query', () => {
    const result = buildContextQuerySql(baseSql, 'timestamp', 'fromUnixTimestamp64Nano(123)', 'backward', 10, []);

    expect(result).toContain('"timestamp" <= fromUnixTimestamp64Nano(123)');
    expect(result).toContain('ORDER BY "timestamp" DESC');
    expect(result).toContain('LIMIT 10');
  });

  it('adds context filters', () => {
    const result = buildContextQuerySql(baseSql, 'timestamp', 'fromUnixTimestamp64Nano(123)', 'forward', 10, [
      { column: 'service', value: 'api-gateway' },
      { column: 'pod', value: 'pod-123' },
    ]);

    expect(result).toContain('"service" = \'api-gateway\'');
    expect(result).toContain('"pod" = \'pod-123\'');
  });

  it('escapes single quotes in filter values', () => {
    const result = buildContextQuerySql(baseSql, 'timestamp', 'fromUnixTimestamp64Nano(123)', 'forward', 10, [
      { column: 'message', value: "it's a test" },
    ]);

    expect(result).toContain("\"message\" = 'it''s a test'");
  });

  it('handles query with existing ORDER BY and LIMIT', () => {
    const sql = 'SELECT * FROM logs ORDER BY old_col ASC LIMIT 50';
    const result = buildContextQuerySql(sql, 'timestamp', 'fromUnixTimestamp64Nano(123)', 'backward', 10, []);

    expect(result).toContain('ORDER BY "timestamp" DESC');
    expect(result).toContain('LIMIT 10');
    expect(result).not.toContain('old_col');
    expect(result).not.toContain('LIMIT 50');
  });

  it('returns original sql when timeColumn is empty', () => {
    expect(buildContextQuerySql(baseSql, '', 'ts', 'forward', 10, [])).toBe(baseSql);
  });
});

describe('findMainClausePosition', () => {
  it('finds ORDER BY', () => {
    const sql = 'SELECT * FROM table ORDER BY ts';
    const pos = findMainClausePosition(sql, 'ORDER BY');
    expect(pos).toBeGreaterThan(0);
    expect(sql.slice(pos, pos + 8)).toBe('ORDER BY');
  });

  it('skips ORDER BY in subquery', () => {
    const sql = 'SELECT * FROM (SELECT * FROM t ORDER BY x) WHERE y = 1';
    const pos = findMainClausePosition(sql, 'ORDER BY');
    expect(pos).toBe(-1);
  });
});

describe('removeOrderBy', () => {
  it('removes ORDER BY at end', () => {
    expect(removeOrderBy('SELECT * FROM table ORDER BY ts')).toBe('SELECT * FROM table');
  });

  it('removes ORDER BY before LIMIT', () => {
    expect(removeOrderBy('SELECT * FROM table ORDER BY ts LIMIT 100')).toBe('SELECT * FROM table LIMIT 100');
  });

  it('returns original when no ORDER BY', () => {
    const sql = 'SELECT * FROM table';
    expect(removeOrderBy(sql)).toBe(sql);
  });
});

describe('removeLimit', () => {
  it('removes LIMIT at end', () => {
    expect(removeLimit('SELECT * FROM table LIMIT 100')).toBe('SELECT * FROM table');
  });

  it('removes LIMIT before SETTINGS', () => {
    expect(removeLimit('SELECT * FROM table LIMIT 100 SETTINGS x=1')).toBe('SELECT * FROM table SETTINGS x=1');
  });

  it('returns original when no LIMIT', () => {
    const sql = 'SELECT * FROM table';
    expect(removeLimit(sql)).toBe(sql);
  });
});

describe('hasOrderBy', () => {
  it('returns true when ORDER BY exists', () => {
    expect(hasOrderBy('SELECT * FROM table ORDER BY ts')).toBe(true);
  });

  it('returns true when ORDER BY exists with direction', () => {
    expect(hasOrderBy('SELECT * FROM table ORDER BY ts DESC')).toBe(true);
  });

  it('returns false when no ORDER BY', () => {
    expect(hasOrderBy('SELECT * FROM table')).toBe(false);
  });

  it('returns false for empty sql', () => {
    expect(hasOrderBy('')).toBe(false);
  });

  it('ignores ORDER BY in subquery', () => {
    expect(hasOrderBy('SELECT * FROM (SELECT * FROM t ORDER BY x)')).toBe(false);
  });

  it('detects ORDER BY after subquery', () => {
    expect(hasOrderBy('SELECT * FROM (SELECT * FROM t ORDER BY x) ORDER BY y')).toBe(true);
  });
});

describe('injectOrderBy', () => {
  it('injects ORDER BY when none exists', () => {
    const sql = 'SELECT * FROM table';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC');
  });

  it('injects ORDER BY ASC', () => {
    const sql = 'SELECT * FROM table';
    expect(injectOrderBy(sql, 'ts', 'ASC')).toBe('SELECT * FROM table ORDER BY "ts" ASC');
  });

  it('does not inject when ORDER BY already exists', () => {
    const sql = 'SELECT * FROM table ORDER BY old_col ASC';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(sql);
  });

  it('injects before LIMIT', () => {
    const sql = 'SELECT * FROM table LIMIT 100';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC LIMIT 100');
  });

  it('injects before SETTINGS', () => {
    const sql = 'SELECT * FROM table SETTINGS max_execution_time=60';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(
      'SELECT * FROM table ORDER BY "ts" DESC SETTINGS max_execution_time=60'
    );
  });

  it('removes trailing semicolon', () => {
    const sql = 'SELECT * FROM table;';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe('SELECT * FROM table ORDER BY "ts" DESC');
  });

  it('returns original when column is empty', () => {
    const sql = 'SELECT * FROM table';
    expect(injectOrderBy(sql, '', 'DESC')).toBe(sql);
  });

  it('returns original when sql is empty', () => {
    expect(injectOrderBy('', 'ts', 'DESC')).toBe('');
  });

  it('skips injection for aggregate query without GROUP BY', () => {
    const sql = 'SELECT count() FROM table';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(sql);
  });

  it('skips injection for sum aggregate', () => {
    const sql = 'SELECT sum(value) FROM table';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(sql);
  });

  it('skips injection for multiple aggregates', () => {
    const sql = 'SELECT count(), avg(value) FROM table';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(sql);
  });

  it('injects ORDER BY for aggregate with GROUP BY', () => {
    const sql = 'SELECT status, count() FROM table GROUP BY status';
    expect(injectOrderBy(sql, 'ts', 'DESC')).toBe(
      'SELECT status, count() FROM table GROUP BY status ORDER BY "ts" DESC'
    );
  });
});

describe('isAggregateQueryWithoutGroupBy', () => {
  const { isAggregateQueryWithoutGroupBy } = _testExports;

  it('returns true for count() without GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT count() FROM table')).toBe(true);
  });

  it('returns true for sum() without GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT sum(value) FROM table')).toBe(true);
  });

  it('returns true for avg() without GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT avg(price) FROM orders')).toBe(true);
  });

  it('returns true for min/max without GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT min(ts), max(ts) FROM table')).toBe(true);
  });

  it('returns true for uniq() without GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT uniq(user_id) FROM events')).toBe(true);
  });

  it('returns false for aggregate with GROUP BY', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT status, count() FROM table GROUP BY status')).toBe(false);
  });

  it('returns false for non-aggregate query', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT * FROM table')).toBe(false);
  });

  it('returns false for query with column selection', () => {
    expect(isAggregateQueryWithoutGroupBy('SELECT id, name, timestamp FROM logs')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAggregateQueryWithoutGroupBy('')).toBe(false);
  });

  it('handles case insensitivity', () => {
    expect(isAggregateQueryWithoutGroupBy('select COUNT(*) from table')).toBe(true);
    expect(isAggregateQueryWithoutGroupBy('SELECT Count() FROM table')).toBe(true);
  });
});

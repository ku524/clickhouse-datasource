import { hasLimit, injectLimit, _testExports } from './autoLogsLimit';
import { findMainClausePosition } from './sqlUtils';

const { appendLimitClause } = _testExports;

describe('hasLimit', () => {
  describe('detects LIMIT clause', () => {
    it('detects simple LIMIT', () => {
      expect(hasLimit('SELECT * FROM table LIMIT 100')).toBe(true);
    });

    it('detects LIMIT with ORDER BY', () => {
      expect(hasLimit('SELECT * FROM table ORDER BY ts DESC LIMIT 100')).toBe(true);
    });

    it('detects LIMIT with WHERE', () => {
      expect(hasLimit('SELECT * FROM table WHERE x = 1 LIMIT 50')).toBe(true);
    });

    it('is case insensitive', () => {
      expect(hasLimit('SELECT * FROM table limit 100')).toBe(true);
      expect(hasLimit('SELECT * FROM table Limit 100')).toBe(true);
    });
  });

  describe('returns false when no LIMIT', () => {
    it('returns false for simple query', () => {
      expect(hasLimit('SELECT * FROM table')).toBe(false);
    });

    it('returns false for query with WHERE', () => {
      expect(hasLimit('SELECT * FROM table WHERE status = 1')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasLimit('')).toBe(false);
    });
  });

  describe('handles subqueries', () => {
    it('ignores LIMIT inside subquery', () => {
      expect(hasLimit('SELECT * FROM (SELECT * FROM t LIMIT 10)')).toBe(false);
    });

    it('detects LIMIT outside subquery', () => {
      expect(hasLimit('SELECT * FROM (SELECT * FROM t) LIMIT 100')).toBe(true);
    });
  });
});

describe('injectLimit', () => {
  describe('skips injection when not needed', () => {
    it('returns original SQL when limit is 0', () => {
      const sql = 'SELECT * FROM table';
      expect(injectLimit(sql, 0)).toBe(sql);
    });

    it('returns original SQL when limit is negative', () => {
      const sql = 'SELECT * FROM table';
      expect(injectLimit(sql, -1)).toBe(sql);
    });

    it('returns original SQL when LIMIT already exists', () => {
      const sql = 'SELECT * FROM table LIMIT 50';
      expect(injectLimit(sql, 100)).toBe(sql);
    });

    it('skips non-SELECT queries', () => {
      const sql = 'INSERT INTO table VALUES (1, 2)';
      expect(injectLimit(sql, 100)).toBe(sql);
    });

    it('returns original SQL when sql is empty', () => {
      expect(injectLimit('', 100)).toBe('');
    });
  });

  describe('injects LIMIT correctly', () => {
    it('appends LIMIT to simple query', () => {
      const sql = 'SELECT * FROM table';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table LIMIT 1000');
    });

    it('appends LIMIT after WHERE', () => {
      const sql = 'SELECT * FROM table WHERE status = 1';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table WHERE status = 1 LIMIT 1000');
    });

    it('appends LIMIT after ORDER BY', () => {
      const sql = 'SELECT * FROM table ORDER BY ts DESC';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table ORDER BY ts DESC LIMIT 1000');
    });

    it('appends LIMIT after GROUP BY', () => {
      const sql = 'SELECT status, count(*) FROM table GROUP BY status';
      expect(injectLimit(sql, 1000)).toBe('SELECT status, count(*) FROM table GROUP BY status LIMIT 1000');
    });

    it('removes trailing semicolon', () => {
      const sql = 'SELECT * FROM table;';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table LIMIT 1000');
    });

    it('inserts before SETTINGS', () => {
      const sql = 'SELECT * FROM table SETTINGS max_execution_time=60';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table LIMIT 1000 SETTINGS max_execution_time=60');
    });

    it('inserts before FORMAT', () => {
      const sql = 'SELECT * FROM table FORMAT JSON';
      expect(injectLimit(sql, 1000)).toBe('SELECT * FROM table LIMIT 1000 FORMAT JSON');
    });
  });

  describe('handles complex queries', () => {
    it('handles query with WHERE and ORDER BY', () => {
      const sql = 'SELECT * FROM table WHERE x = 1 ORDER BY ts DESC';
      expect(injectLimit(sql, 100)).toBe('SELECT * FROM table WHERE x = 1 ORDER BY ts DESC LIMIT 100');
    });

    it('handles query with multiple clauses', () => {
      const sql = 'SELECT * FROM table WHERE x = 1 GROUP BY y ORDER BY z';
      expect(injectLimit(sql, 100)).toBe('SELECT * FROM table WHERE x = 1 GROUP BY y ORDER BY z LIMIT 100');
    });

    it('handles query with subquery', () => {
      const sql = 'SELECT * FROM (SELECT * FROM t LIMIT 10) ORDER BY x';
      expect(injectLimit(sql, 100)).toBe('SELECT * FROM (SELECT * FROM t LIMIT 10) ORDER BY x LIMIT 100');
    });
  });
});

describe('findMainClausePosition', () => {
  it('finds LIMIT in simple query', () => {
    const sql = 'SELECT * FROM table LIMIT 100';
    const pos = findMainClausePosition(sql, 'LIMIT');
    expect(pos).toBeGreaterThan(0);
    expect(sql.slice(pos, pos + 5)).toBe('LIMIT');
  });

  it('returns -1 when clause not found', () => {
    const sql = 'SELECT * FROM table';
    const pos = findMainClausePosition(sql, 'LIMIT');
    expect(pos).toBe(-1);
  });

  it('skips LIMIT inside subquery', () => {
    const sql = 'SELECT * FROM (SELECT * FROM t LIMIT 10) ORDER BY x';
    const pos = findMainClausePosition(sql, 'LIMIT');
    expect(pos).toBe(-1);
  });

  it('finds LIMIT outside subquery', () => {
    const sql = 'SELECT * FROM (SELECT * FROM t) LIMIT 100';
    const pos = findMainClausePosition(sql, 'LIMIT');
    expect(pos).toBeGreaterThan(0);
  });
});

describe('appendLimitClause', () => {
  it('appends LIMIT at the end', () => {
    expect(appendLimitClause('SELECT * FROM table', 100)).toBe('SELECT * FROM table LIMIT 100');
  });

  it('inserts before SETTINGS', () => {
    expect(appendLimitClause('SELECT * FROM table SETTINGS x=1', 100)).toBe(
      'SELECT * FROM table LIMIT 100 SETTINGS x=1'
    );
  });

  it('inserts before FORMAT', () => {
    expect(appendLimitClause('SELECT * FROM table FORMAT JSON', 100)).toBe('SELECT * FROM table LIMIT 100 FORMAT JSON');
  });
});

import type { QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a parameterized query: a Pool, a Client, or a PoolClient. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

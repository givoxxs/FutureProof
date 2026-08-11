import test from "node:test";
import assert from "node:assert/strict";
import { resolveAnalysisConcurrency } from "../../apps/api/src/server.ts";

test("analysis concurrency defaults to two", () => {
  assert.equal(resolveAnalysisConcurrency({}), 2);
});

test("analysis concurrency accepts only integers one through four", () => {
  for (const value of ["1", "2", "3", "4"]) {
    assert.equal(resolveAnalysisConcurrency({ FUTUREPROOF_ANALYSIS_CONCURRENCY: value }), Number(value));
  }

  for (const value of ["0", "5", "2.5", "abc", "-1"]) {
    assert.throws(
      () => resolveAnalysisConcurrency({ FUTUREPROOF_ANALYSIS_CONCURRENCY: value }),
      /1 through 4/,
      `expected ${value} to be rejected`,
    );
  }
});

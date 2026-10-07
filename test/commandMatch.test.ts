import assert from "node:assert/strict";
import test from "node:test";
import { defaultFilter } from "cmdk";
import { commandMatch } from "../web/src/lib/commandMatch.ts";

test("palette highlight alignment follows cmdk scoring, including gaps and typos", () => {
  const values = ["Copy all", "Copy working directory", "Student location options openapply develop", "appearance light", "research/student_location-cache", "a50d8fbe-60c2-45e5-806f-b21a60387f57"];
  const queries = ["copy all", "cpa", "options", "student", "slo", "coopy", "cpoy", "LIGHT", "research cache", "a50d", "no match"];
  for (const value of values) for (const query of queries) {
    const match = commandMatch(value, query);
    assert.equal(match.score, defaultFilter(value, query), `${value}: ${query}`);
    assert.ok(match.indices.every(i => i >= 0 && i < value.length));
  }
  assert.deepEqual(commandMatch("Copy all", "copy all").indices, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(commandMatch("Copy all", "cpa").indices, [0, 2, 5]);
  assert.deepEqual(commandMatch("Copy all", "cpoy").indices, [0, 1, 2, 3]);
  assert.deepEqual(commandMatch("Copy all", "").indices, []);
});

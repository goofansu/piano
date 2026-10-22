import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateGroups,
  folderGroups,
  projectGroups,
  SORT_BY,
  sortSessions,
} from "../web/src/lib/sidebarView.ts";

const datedSession = (title: string, updatedAt?: string) => ({ title, updatedAt });

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`;
const session = (
  cwd: string,
  sessionId: string,
  title: string | undefined,
  day: number,
  projectId?: string,
) => ({
  cwd,
  sessionId,
  title,
  updatedAt: at(day),
  folderPath: cwd,
  projectId,
});
const titles = (items: ReadonlyArray<{ title?: string }>) => items.map((s) => s.title);
const folders = [
  { path: "/zeta", name: "zeta" },
  { path: "/alpha", name: "Alpha" },
  { path: "/beta-10", name: "beta-10" },
  { path: "/beta-2", name: "beta-2" },
];
const sessions = [
  session("/zeta", "z1", "Zeta old", 1),
  session("/zeta", "z2", "Zeta new", 7),
  session("/beta-10", "b1", undefined, 8),
  session("/beta-10", "b2", "Beta titled", 3),
  session("/beta-2", "c1", "Carol", 7),
];

test("sidebar view: date sections use inclusive calendar boundaries, omit empties and lose no unknown dates", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const input = [
      [
        datedSession("today", "2026-03-31T00:00:00-04:00"),
        datedSession("future", "2026-04-02T12:00:00-04:00"),
        datedSession("yesterday", "2026-03-30T23:59:59-04:00"),
      ],
      [
        datedSession("two", "2026-03-29T23:59:59-04:00"),
        datedSession("seven", "2026-03-24T00:00:00-04:00"),
        datedSession("eight", "2026-03-23T23:59:59-04:00"),
        datedSession("thirty", "2026-03-01T00:00:00-05:00"),
        datedSession("older", "2026-02-28T23:59:59-05:00"),
        datedSession("missing"),
        datedSession("invalid", "not a date"),
        datedSession("empty", ""),
      ],
    ];
    const result = dateGroups(input.flat(), "recent", new Date("2026-03-31T00:05:00-04:00"));
    assert.deepEqual(
      result.map((g) => [g.label, titles(g.sessions)]),
      [
        ["Today", ["future", "today"]],
        ["Yesterday", ["yesterday"]],
        ["Previous 7 days", ["two", "seven"]],
        ["Previous 30 days", ["eight", "thirty"]],
        ["Older", ["older"]],
        ["Unknown date", ["invalid", "empty", "missing"]],
      ],
    );
    assert.equal(result.flatMap((g) => g.sessions).length, input.flat().length);
    assert.deepEqual(
      dateGroups([], "recent").map((g) => g.label),
      [],
    );
    assert.deepEqual(
      dateGroups(input[0]!, "name", new Date("2026-03-31T12:00:00-04:00")).map((g) => [
        g.label,
        titles(g.sessions),
      ]),
      [
        ["Today", ["future", "today"]],
        ["Yesterday", ["yesterday"]],
      ],
      "empty buckets are omitted and Name sorts within, not across, sections",
    );
    const byName = dateGroups(input.flat(), "name", new Date("2026-03-31T12:00:00-04:00"));
    assert.deepEqual(titles(byName[2]!.sessions), ["seven", "two"]);
    assert.equal(input[0]![0]!.title, "today", "input order is preserved");
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("sidebar view: local midnight and both DST transitions are calendar days, not elapsed durations", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const spring = [
      datedSession("late Saturday", "2026-03-07T23:59:00-05:00"),
      datedSession("early Sunday", "2026-03-08T00:00:00-05:00"),
    ];
    assert.deepEqual(
      dateGroups(spring, "recent", new Date("2026-03-09T00:01:00-04:00")).map((g) => [
        g.label,
        titles(g.sessions),
      ]),
      [
        ["Yesterday", ["early Sunday"]],
        ["Previous 7 days", ["late Saturday"]],
      ],
      "a time less than 24 hours ago can be two calendar days ago at spring-forward",
    );
    const fall = [datedSession("early Sunday", "2026-11-01T00:00:00-04:00")];
    assert.equal(
      dateGroups(fall, "recent", new Date("2026-11-02T00:01:00-05:00"))[0]!.label,
      "Yesterday",
      "yesterday can be over 25 hours ago at fall-back",
    );
    const midnight = [datedSession("last minute", "2026-03-31T23:59:00-04:00")];
    assert.equal(
      dateGroups(midnight, "recent", new Date("2026-03-31T23:59:59-04:00"))[0]!.label,
      "Today",
    );
    assert.equal(
      dateGroups(midnight, "recent", new Date("2026-04-01T00:00:00-04:00"))[0]!.label,
      "Yesterday",
    );
    assert.equal(
      dateGroups(
        [datedSession("UTC next day", "2026-04-01T02:00:00Z")],
        "recent",
        new Date("2026-03-31T23:00:00-04:00"),
      )[0]!.label,
      "Today",
      "grouping uses the local date, not the ISO date prefix",
    );
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("sidebar view: sessions sort by title with untitled last, or by last activity", () => {
  assert.deepEqual(titles(sortSessions(sessions, "name")), [
    "Beta titled",
    "Carol",
    "Zeta new",
    "Zeta old",
    undefined,
  ]);
  assert.deepEqual(
    titles(sortSessions(sessions, "recent")),
    [undefined, "Carol", "Zeta new", "Beta titled", "Zeta old"],
    "a tie on activity falls back to the title",
  );
  const tied = ["Task 10", "task 2", "TASK 2", undefined, "task 1"].map((title) => ({ title }));
  assert.deepEqual(
    sortSessions(tied, "name"),
    [tied[4], tied[1], tied[2], tied[0], tied[3]],
    "numeric case-insensitive ties retain input order, with untitled last",
  );
});

for (const { value: sort } of SORT_BY) {
  test(`sidebar view: folders stay A–Z with ${sort} session sort, including empty folders`, () => {
    const groups = folderGroups(folders, sessions, sort);
    assert.deepEqual(
      groups.map((g) => g.folder.name),
      ["Alpha", "beta-2", "beta-10", "zeta"],
      "group names are case-insensitive and numeric-aware, independent of activity",
    );
    assert.deepEqual(
      groups.map((g) => titles(g.sessions)),
      [
        [],
        ["Carol"],
        {
          name: ["Beta titled", undefined],
          recent: [undefined, "Beta titled"],
        }[sort],
        ["Zeta new", "Zeta old"],
      ],
      "only sessions inside each folder follow the selected sort",
    );
    assert.deepEqual(
      folders.map((f) => f.name),
      ["zeta", "Alpha", "beta-10", "beta-2"],
      "the input is not reordered in place",
    );
  });
}

test("sidebar view: project groups hold their members, then a No project group holds the sessions filed nowhere", () => {
  const projects = [
    { id: "launch", name: "Launch subscriptions" },
    { id: "a11y", name: "Improve accessibility" },
    { id: "empty", name: "Empty project" },
  ];
  const listed = [
    session("/zeta", "z1", "Zeta old", 1, "launch"),
    session("/beta-10", "b2", "Beta titled", 3, "a11y"),
    session("/zeta", "z2", "Zeta new", 7, "launch"),
    { ...session("/closed", "gone", "Closed folder member", 9, "a11y"), folderPath: undefined },
    session("/beta-2", "c1", "Carol", 7),
    session("/beta-10", "b1", undefined, 8),
  ];
  for (const { value: sort } of SORT_BY) {
    const groups = projectGroups(projects, listed, sort);
    assert.deepEqual(
      groups.map((g) => g.project?.name ?? null),
      ["Empty project", "Improve accessibility", "Launch subscriptions", null],
      `project groups stay A–Z with ${sort} session sort; No project stays last`,
    );
    assert.deepEqual(
      groups.map((g) => titles(g.sessions)),
      {
        name: [
          [],
          ["Beta titled", "Closed folder member"],
          ["Zeta new", "Zeta old"],
          ["Carol", undefined],
        ],
        recent: [
          [],
          ["Closed folder member", "Beta titled"],
          ["Zeta new", "Zeta old"],
          [undefined, "Carol"],
        ],
      }[sort],
      `members, including closed-folder and unfiled sessions, follow ${sort} sort`,
    );
  }
  assert.deepEqual(
    projects.map((p) => p.id),
    ["launch", "a11y", "empty"],
    "input order is preserved",
  );
});

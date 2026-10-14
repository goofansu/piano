import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSessionEvent } from "../server/DisplayProjection.ts";
import { dialogAnswerFor, modelChoicesOf, piExchangeFor } from "../server/PiRecords.ts";
import type { Dialog } from "../shared/wire.ts";

/** What reaches Pi's stdin for an action, or why nothing does. */
const sent = (action: Parameters<typeof piExchangeFor>[0]) => {
  const exchange = piExchangeFor(action);
  return "rejected" in exchange ? exchange : { command: exchange.command };
};

/** An action's exchange, which these actions always produce. */
const exchangeFor = <A extends Parameters<typeof piExchangeFor>[0]>(action: A) => {
  const exchange = piExchangeFor(action);
  assert.ok(!("rejected" in exchange), `${action._tag} must be sent`);
  return exchange;
};

// Expected efforts follow pi-ai getSupportedThinkingLevels: off..high unless mapped to null,
// xhigh and max only when mapped, and off alone for a model that cannot reason.
test("INV-12: Pi's model reply becomes model choices with the efforts Pi accepts and its enabledModels scope", () => {
  const reply = {
    models: [
      {
        provider: "anthropic",
        id: "claude-opus",
        name: "Opus",
        reasoning: true,
        contextWindow: 200_000,
        cost: { input: 1 },
        input: ["text"],
      },
      {
        provider: "openai",
        id: "gpt-5",
        reasoning: true,
        contextWindow: 400_000,
        thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" },
      },
      {
        provider: "openai",
        id: "gpt-5-mini",
        reasoning: false,
        contextWindow: 128_000,
        thinkingLevelMap: { xhigh: "xhigh" },
      },
      { provider: "local", id: "plain", contextWindow: 8_000 },
    ],
  };
  assert.deepEqual(modelChoicesOf(reply, ["Anthropic/claude-*", "GPT-5"]), [
    {
      ref: "anthropic/claude-opus",
      provider: "anthropic",
      id: "claude-opus",
      name: "Opus",
      reasoning: true,
      contextWindow: 200_000,
      enabled: true,
      thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    },
    {
      ref: "openai/gpt-5",
      provider: "openai",
      id: "gpt-5",
      name: undefined,
      reasoning: true,
      contextWindow: 400_000,
      enabled: true,
      thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    },
    {
      ref: "openai/gpt-5-mini",
      provider: "openai",
      id: "gpt-5-mini",
      name: undefined,
      reasoning: false,
      contextWindow: 128_000,
      enabled: false,
      thinkingLevels: ["off"],
    },
    {
      ref: "local/plain",
      provider: "local",
      id: "plain",
      name: undefined,
      reasoning: false,
      contextWindow: 8_000,
      enabled: false,
      thinkingLevels: ["off"],
    },
  ]);
  assert.ok(
    modelChoicesOf(reply, [])?.every((m) => !m.enabled),
    "without patterns Pi scopes nothing in",
  );
});

test("a malformed model reply is refused rather than offered as choices", () => {
  for (const reply of [
    undefined,
    {},
    { models: "none" },
    { models: [{ provider: "p", id: "x" }] },
  ]) {
    assert.equal(modelChoicesOf(reply, []), undefined, JSON.stringify(reply));
  }
});

test("INV-12: a model ref that is not provider/id is refused before reaching Pi", () => {
  for (const model of ["gpt-5", "/gpt-5", ""]) {
    assert.deepEqual(sent({ _tag: "set_model", model }), {
      rejected: `Model must be provider/id, got "${model}"`,
    });
  }
  // Only the first slash separates the provider; Pi's model IDs may contain more.
  assert.deepEqual(sent({ _tag: "set_model", model: "openrouter/openai/gpt-5" }), {
    command: { type: "set_model", provider: "openrouter", modelId: "openai/gpt-5" },
  });
});

test("INV-03: text and image input carry their streaming behaviour", () => {
  const png = {
    kind: "image" as const,
    name: "dot.png",
    mimeType: "image/png" as const,
    data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString("base64"),
  };
  assert.deepEqual(sent({ _tag: "steer", text: "now" }), {
    command: { type: "prompt", message: "now", streamingBehavior: "steer" },
  });
  assert.deepEqual(sent({ _tag: "prompt", text: "later" }), {
    command: { type: "prompt", message: "later", streamingBehavior: "followUp" },
  });
  assert.deepEqual(sent({ _tag: "steer", text: "look", attachments: [png] }), {
    command: {
      type: "prompt",
      message: "look",
      streamingBehavior: "steer",
      images: [{ type: "image", data: png.data, mimeType: "image/png" }],
    },
  });
  assert.ok(
    "rejected" in
      sent({
        _tag: "steer",
        text: "look",
        attachments: [{ ...png, mimeType: "image/jpeg" }],
      }),
    "bytes must match the declared type",
  );
});

test("INV-03: input's reply decodes to how Pi took it; any other reply breaks the protocol", () => {
  for (const action of [
    { _tag: "prompt", text: "hi" },
    { _tag: "steer", text: "now" },
  ] as const) {
    const exchange = exchangeFor(action);
    for (const disposition of ["started", "queued", "handled"] as const)
      assert.equal(exchange.decode({ disposition }), disposition);
    for (const reply of [undefined, null, {}, "started", { disposition: "done" }])
      assert.equal(exchange.decode(reply), undefined, JSON.stringify(reply));
    assert.equal(
      exchange.invalid,
      "Pi acknowledged the input without a recognized disposition. Inspect the session before sending again.",
    );
  }
});

test("INV-03: clear_queue's reply decodes to the taken-back queue, steering first", () => {
  const exchange = exchangeFor({ _tag: "restore_queue" });
  assert.deepEqual(exchange.command, { type: "clear_queue" });
  assert.deepEqual(exchange.decode({ steering: ["s1", "s2"], followUp: ["f1"] }), [
    { kind: "steering", text: "s1" },
    { kind: "steering", text: "s2" },
    { kind: "follow-up", text: "f1" },
  ]);
  assert.deepEqual(exchange.decode({ steering: [], followUp: [] }), []);
  for (const reply of [
    undefined,
    {},
    { steering: ["s"] },
    { steering: "s", followUp: [] },
    { steering: [1], followUp: [] },
  ])
    assert.equal(exchange.decode(reply), undefined, JSON.stringify(reply));
  assert.equal(exchange.invalid, "Pi returned an invalid cleared queue.");
});

test("a command Pi only acknowledges accepts any reply, including none", () => {
  for (const action of [
    { _tag: "abort" },
    { _tag: "set_model", model: "anthropic/claude-opus" },
    { _tag: "set_thinking_level", level: "high" },
    { _tag: "set_name", name: "Renamed" },
  ] as const) {
    const exchange = exchangeFor(action);
    for (const reply of [undefined, {}, { unexpected: true }])
      assert.notEqual(exchange.decode(reply), undefined, `${action._tag} ${JSON.stringify(reply)}`);
  }
});

test("INV-04: a dialog answer reaches Pi as its original value, and cancel as a cancellation", () => {
  const dialog = {
    id: "d1",
    generation: "g",
    receivedAt: 0,
    deadlineAt: 1,
    deadlineKind: "host-recovery" as const,
    method: "select" as const,
    options: ["Use sk-alpha111", "Use sk-beta2222", "Use token=abc12345"],
  };
  const answer = (value: string, cancelled?: boolean) =>
    dialogAnswerFor({ _tag: "answer", id: "d1", generation: "g", value, cancelled }, dialog);
  // The browser saw only redacted labels; a unique one still selects the original option.
  assert.deepEqual(answer("Use token=[REDACTED]"), {
    command: { type: "extension_ui_response", id: "d1", value: "Use token=abc12345" },
  });
  // Two options share "Use [REDACTED]": refuse instead of guessing.
  assert.deepEqual(answer("Use [REDACTED]"), {
    rejected: "This option is unavailable or ambiguous after redaction. Cancel the dialog instead.",
  });
  assert.deepEqual(answer("Use [REDACTED]", true), {
    command: { type: "extension_ui_response", id: "d1", cancelled: true },
  });
  assert.deepEqual(
    dialogAnswerFor(
      { _tag: "answer", id: "d1", generation: "g", confirmed: false },
      { ...dialog, method: "confirm", options: undefined },
    ),
    { command: { type: "extension_ui_response", id: "d1", confirmed: false } },
  );
});

test("INV-11: a select option shown through the published dialog answers with its original value", () => {
  // A known secret is compiled once for the whole published dialog and again for each option
  // when the answer is matched: both passes must apply the same rule.
  process.env.PIANO_ROUNDTRIP_TOKEN = "roundtrip-secret-0123";
  try {
    const dialog: Dialog = {
      id: "d2",
      generation: "g",
      receivedAt: 0,
      deadlineAt: 1,
      deadlineKind: "host-recovery",
      method: "select",
      options: [
        "Deploy with roundtrip-secret-0123",
        "Use Bearer abc.def",
        "Read password: hunter2xyz",
        "\u001b[1mBold\u001b[0m plain",
      ],
    };
    const published = projectSessionEvent({ _tag: "dialog", dialog });
    assert.ok(published._tag === "dialog");
    const labels = published.dialog.options ?? [];
    assert.deepEqual(labels, [
      "Deploy with [REDACTED]",
      "Use Bearer [REDACTED]",
      "Read password: [REDACTED]",
      "Bold plain",
    ]);
    labels.forEach((value, i) => {
      assert.deepEqual(
        dialogAnswerFor({ _tag: "answer", id: "d2", generation: "g", value }, dialog),
        {
          command: { type: "extension_ui_response", id: "d2", value: dialog.options![i] },
        },
      );
    });
  } finally {
    delete process.env.PIANO_ROUNDTRIP_TOKEN;
  }
});

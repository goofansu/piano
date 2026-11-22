# Settings › Preferences › Voice input

## Driving it with agent-browser

Preconditions: a seeded launch. No OpenAI key is needed.

- `preferences`
  - Action: `ab open "$WEB_URL/settings/preferences"; ab wait --text "Voice input"`;
    capture `01-preferences`, then `ab find role switch click --name "Voice input" --exact;
    ab wait --text "OpenAI API key"`.
  - Result: the key dialog explains the data sent to OpenAI. Capture `02-key-prerequisite`, then
    `ab find role button click --name "Cancel" --exact;
    ab wait --fn "!document.querySelector('[role=dialog]')"`.
    Voice input remains off. Capture `03-cancelled`; no key was saved or recording sent.

## Gotchas

- Voice transcription requires an approved OpenAI key, browser microphone permission and a
  recording-capable browser. The Preferences → Voice input → key-dialog route proves the
  missing-key prerequisite, not recording, context transmission or transcription into the draft.

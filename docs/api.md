# Local session API

PIN-31's single-user orchestration API is **off by default**. Enable one separate listener:

```sh
PIANO_API_SOCKET=/home/exedev/.piano/api.sock npm start  # preferred; socket mode 0600
# Or: PIANO_API_PORT=8002 npm start                    # binds only 127.0.0.1
```

Set these variables on the backend when you next deliberately start it; do not start a second
backend on the same database. The socket takes precedence when both variables are set. Its parent
is created if needed; an existing socket/path is never overwritten. After a crash, remove a stale
socket only after confirming its backend is no longer running.

**Never forward this listener through the exe.dev HTTPS proxy.** The proxy itself connects from
loopback, so loopback is not caller authentication. No bearer token is implemented. The main
browser listener always returns 404 for `/api/v1/*`; the API listener serves only the endpoints
below. Any `Origin` header, including an empty one, gets 403
`{"error":"Origin not allowed on API."}`. Existing browser and WebSocket origin policy is unchanged.

## Requests

All bodies and responses are JSON. Put registered IDs in query parameters, never filesystem paths
in URLs. Errors have the shape `{"error":"…"}`: 400 invalid input/unregistered cwd, 403 Origin,
404 missing route/unknown ID, or 409 unavailable/busy session. Missing required IDs return 400.

| Method and path (under `/api/v1`) | Body | Response |
| --- | --- | --- |
| `POST /sessions` | `{"cwd":"/registered/folder","prompt":"…","model":"provider/model","requestId":"r-1"}`; model and requestId optional | `{"workspaceId":"…","sessionId":"…","seq":1}` |
| `POST /sessions/messages?workspaceId=…&sessionId=…` | `{"prompt":"…","mode":"prompt","requestId":"r-2"}`; mode defaults to prompt, or use steer | `{"seq":2}` |
| `GET /sessions?workspaceId=…&sessionId=…` | none | `{"status":"idle","lastAssistantMessage":"…","detail":null,"hosted":false,"seq":2,"completedSeq":2}` |
| `GET /sessions/list` | none | `[{"workspaceId":"…","sessionId":"…","cwd":"…","status":"idle","hosted":false}]` |
| `POST /sessions/abort?workspaceId=…&sessionId=…` | `{}` or `{"stop":true}` | `{"ok":true}` |

Create requires an already registered folder or worktree. Create/send return after host admission,
not turn completion. Send reopens released history, refuses running/waiting sessions unless steering,
and always refuses a missing checkout or a stopping session. Abort cancels current work; stop also
releases/kills Pi. Aborting idle or already released history is a no-op.

Status precedence is error, waiting (dialog), running, idle. `detail` explains errors or waiting.
API-owned hosts cancel extension dialogs automatically; there is no answer endpoint. Read never
starts Pi. List uses only Piano's database and live hosts, not per-session history scans; unhosted
status is last-known idle/error. Assistant text is display-projected like the browser transcript.

Every admitted prompt/steer, including browser input, increments persisted `seq`. Quiescence or
closure advances `completedSeq`. Your turn is done when **status is idle and completedSeq >= your
seq**; error with that counter means failure. Counters survive idle release and backend restart.
A backend interrupted with unfinished turns records their failure on restart.

Use globally unique `requestId` strings (up to 256 characters) for create/send retries. Concurrent
retries share the original operation/response, even across endpoints. The in-memory cache holds up
to 1,000 IDs for ten minutes; completed entries can be evicted earlier when full. It does not survive
a backend restart. Do not automatically resend after that retention window.

## Curl acceptance checks

Use an enabled instance and a folder already added in Piano. On a scratch instance, substitute its
socket, main port and throwaway registered folder. No service restart is required to run checks.

```sh
S=~/.piano/api.sock; A="curl -s --unix-socket $S http://piano/api/v1"
# TCP alternative: A="curl -s http://127.0.0.1:8002/api/v1"
$A/sessions/list
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/api/v1/sessions/list # 404
curl -s --unix-socket "$S" -H 'Origin: https://yejun-dev.exe.xyz' http://piano/api/v1/sessions/list # 403
R=$($A/sessions -H 'Content-Type: application/json' -d '{"cwd":"/home/exedev/piano","prompt":"Reply with exactly: pong","requestId":"t1"}')
echo "$R"
W=$(echo "$R" | jq -r .workspaceId); I=$(echo "$R" | jq -r .sessionId); Q="workspaceId=$W&sessionId=$I"
$A/sessions -H 'Content-Type: application/json' -d '{"cwd":"/home/exedev/piano","prompt":"Reply with exactly: pong","requestId":"t1"}' # same response
# Stop polling on error too; inspect detail rather than waiting forever.
until $A/sessions?$Q | jq -e '(.status=="idle" or .status=="error") and .completedSeq>=1' >/dev/null; do sleep 2; done
$A/sessions?$Q | jq '{status,lastAssistantMessage,detail}' # pong
$A/sessions -H 'Content-Type: application/json' -d '{"cwd":"/nope","prompt":"x"}' -w '%{http_code}\n' # 400
$A/sessions/messages?$Q -H 'Content-Type: application/json' -d '{"prompt":"Count slowly to 200."}' # seq 2
$A/sessions/messages?$Q -H 'Content-Type: application/json' -d '{"prompt":"again"}' -w '%{http_code}\n' # 409 while busy
$A/sessions/abort?$Q -H 'Content-Type: application/json' -d '{}'
$A/sessions?$Q | jq '{status,detail,completedSeq}' # eventually idle/error, completedSeq >= 2
# With PIANO_IDLE_MINUTES=1, wait two minutes, then:
$A/sessions?$Q | jq '{hosted,status}' # false, idle after a clean release; reading does not reopen
$A/sessions/messages?$Q -H 'Content-Type: application/json' -d '{"prompt":"Reply with exactly: pong"}' # seq 3, reopened
```

`test/RealPiApi.test.ts` exercises this lifecycle against the installed Pi with an isolated local
model server, without credentials or paid model calls.

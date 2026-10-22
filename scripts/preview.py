#!/usr/bin/env python3
"""Linux preview ownership adapter. JSON request on stdin, bounded JSON observation on stdout.

No daemon and no third-party packages: systemd owns processes, flock serializes decisions,
and the private state directory retains intent across interrupted callers. See docs/live-previews.md.
"""
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid


class Refused(Exception):
    pass


def run(args, timeout=5):
    # Never pass the caller's credential environment even to supervisor clients.
    env = {"PATH": "/usr/bin:/bin", "XDG_RUNTIME_DIR": f"/run/user/{os.getuid()}",
           "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{os.getuid()}/bus"}
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        result = subprocess.run(args, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
        def tail(stream, size):
            stream.seek(0, os.SEEK_END)
            stream.seek(max(0, stream.tell() - size))
            return stream.read(size).decode(errors="replace")
        if result.returncode:
            raise Refused(f"{args[0]} failed: {tail(stderr, 2000)}")
        return tail(stdout, 16000)


def supervisor():
    if sys.platform != "linux" or os.getuid() == 0:
        raise Refused("Previews require Linux and an unprivileged user with a lingering systemd user manager.")
    group = run(["systemctl", "--user", "show", "-p", "ControlGroup", "--value"]).strip()
    caller = Path("/proc/self/cgroup").read_text().strip().split("::")[-1]
    if not group.startswith("/user.slice/") or caller == group or group.startswith(caller + "/"):
        raise Refused("Cannot establish a user supervisor outside the caller's termination scope.")
    if run(["loginctl", "show-user", str(os.getuid()), "-p", "Linger", "--value"]).strip() != "yes":
        raise Refused("User manager is not lingering. Ask the host administrator; no detached fallback.")
    return group


def unit_state(record):
    output = run(["systemctl", "--user", "show", record["unit"],
                  "-p", "LoadState,ActiveState,SubState,InvocationID,ControlGroup,Result,MainPID"])
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def save(path, record):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as stream:
        json.dump(record, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def owned_binding(record, state):
    """All listeners on this port must be loopback and have an FD in this unit's cgroup.

    Checking before HTTP prevents an unrelated responder from establishing readiness.
    Rechecking afterward bounds the observation; it is not a security sandbox against same-UID code.
    """
    group = state.get("ControlGroup", "")
    if not group or state.get("ActiveState") != "active":
        return False
    inodes = set()
    for table in ["tcp", "tcp6"]:
        for row in Path(f"/proc/net/{table}").read_text().splitlines()[1:]:
            fields = row.split()
            address, port = fields[1].split(":")
            if fields[3] != "0A" or int(port, 16) != record["port"]:
                continue
            if (table, address) not in [("tcp", "0100007F"),
                                        ("tcp6", "00000000000000000000000001000000")]:
                return False
            inodes.add(fields[9])
    if not inodes:
        return False
    owned = set()
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            cgroup = (proc / "cgroup").read_text().strip().split("::")[-1]
            if cgroup != group and not cgroup.startswith(group + "/"):
                continue
            for fd in (proc / "fd").iterdir():
                try:
                    target = os.readlink(fd)
                    if target.startswith("socket:["):
                        owned.add(target[8:-1])
                except OSError:
                    pass
        except (OSError, ProcessLookupError):
            continue
    return inodes.issubset(owned)


def logs(record):
    try:
        output = run(["journalctl", "--user", "-u", record["unit"], "-n", "30",
                      "--no-pager", "-o", "cat"])[-6000:]
        # systemd's start message can include argv, including env assignments.
        for value in record["spec"]["env"].values():
            if value:
                output = output.replace(value, "[redacted]")
        return output[-6000:]
    except Refused as error:
        return str(error)


def observe(record, path):
    state = unit_state(record)
    invocation = state.get("InvocationID", "")
    if record.get("invocation") and invocation and invocation != record["invocation"]:
        raise Refused("Supervisor invocation changed unexpectedly; refusing to adopt or stop it.")
    if invocation and not record.get("invocation"):
        record["invocation"] = invocation
        save(path, record)
    ready = False
    detail = "No owned loopback listener at the selected port. Inspect logs; stop this instance before retrying."
    if owned_binding(record, state):
        connection = http.client.HTTPConnection("127.0.0.1", record["port"], timeout=1)
        try:
            connection.request("GET", record["spec"]["readyPath"])
            response = connection.getresponse()
            ready = 200 <= response.status < 400 and owned_binding(record, unit_state(record))
            detail = f"Local GET {record['spec']['readyPath']}: HTTP {response.status}"
        except (OSError, http.client.HTTPException) as error:
            detail = f"Local readiness: {error}"
        finally:
            connection.close()
    public = {**record, "spec": {**record["spec"], "env": list(record["spec"]["env"])}}
    return {**public, "state": state, "ready": ready, "detail": detail,
            "binding": "127.0.0.1" if ready else None,
            "url": f"{record['spec']['origin']}:{record['port']}/" if ready else None,
            "externalAccess": "unverified", "observedAt": time.time(), "logs": logs(record)}


def choose_port(config, root):
    reserved = {7070, 8000, 8001, *config.get("reservedPorts", [])}
    # Retained intent reserves its port even when submission completion is uncertain.
    for file in root.glob("*.json"):
        reserved.add(json.loads(file.read_text())["port"])
    ports = config.get("ports", list(range(3000, 10000)))
    if not ports or any(type(p) is not int or not 3000 <= p <= 9999 for p in ports):
        raise Refused("ports must be integers in exe.dev's supported range 3000–9999")
    for port in ports:
        if port in reserved:
            continue
        sockets = []
        try:
            for family, address in [(socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")]:
                sock = socket.socket(family)
                sockets.append(sock)
                if family == socket.AF_INET6:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                sock.bind((address, port))
            return port
        except OSError:
            continue
        finally:
            for sock in sockets:
                sock.close()
    raise Refused("No free supported preview port; check configured ports/reservations. No listener was stopped.")


def launch_spec(request, config):
    origin = config.get("origin", "")
    if not re.fullmatch(r"https://[a-zA-Z0-9-]+\.exe\.xyz", origin):
        raise Refused("Configure origin as https://<private-vm>.exe.xyz (no port/path). Never infer it from headers.")
    command = request.get("command")
    if not isinstance(command, list) or not command or any(not isinstance(x, str) or not x or "\0" in x for x in command):
        raise Refused("command must be a nonempty argv array; use {port} and strict binding, not shell backgrounding")
    if not os.path.isabs(command[0]):
        raise Refused("command[0] must be an absolute executable path")
    environment = request.get("env", {})
    if not isinstance(environment, dict) or any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) or not isinstance(v, str) or "\0" in v for k, v in environment.items()):
        raise Refused("env must contain explicit string environment values")
    if "PORT" in environment:
        raise Refused("PORT is allocated by Piano; use {port} in argv or the injected PORT")
    ready_path = request.get("readyPath", "/")
    if not isinstance(ready_path, str) or not ready_path.startswith("/") or "\r" in ready_path or "\n" in ready_path:
        raise Refused("readyPath must be an HTTP path")
    return {"command": command, "env": environment, "readyPath": ready_path, "origin": origin,
            "path": config.get("path", "/usr/local/bin:/usr/bin:/bin")}


def handle(request, root, config):
    workspace = str(Path(request["workspace"]).resolve(strict=True))
    if not Path(workspace).is_dir():
        raise Refused("workspace must be a directory")
    service = "piano-preview-" + hashlib.sha256(workspace.encode()).hexdigest()[:24]
    path = root / f"{service}.json"
    record = json.loads(path.read_text()) if path.exists() else None
    supervisor()
    action = request["action"]
    if action == "status":
        return observe(record, path) if record else {"serviceId": service, "workspace": workspace, "status": "absent"}
    if action == "stop":
        if not request.get("instanceId"):
            raise Refused("stop requires the exact instanceId returned by start/status")
        if not record or request["instanceId"] != record["instanceId"]:
            return {"serviceId": service, "status": "not-current", "stopped": False}
        observe(record, path)  # Reconcile invocation before acting; never kill by port or PID.
        run(["systemctl", "--user", "stop", record["unit"]], timeout=15)
        state = unit_state(record)
        if state.get("ActiveState") not in ["inactive", "failed"]:
            raise Refused("Stop has not completed; retain identity and re-observe before another launch.")
        if state.get("ActiveState") == "failed":
            run(["systemctl", "--user", "reset-failed", record["unit"]])
        path.unlink()
        return {"serviceId": service, "instanceId": record["instanceId"], "status": "stopped", "stopped": True}
    if action != "start":
        raise Refused("action must be start, status or stop")
    spec = launch_spec(request, config)
    if record:
        if record["spec"] != spec:
            raise Refused(f"Launch spec changed. Explicitly stop instance {record['instanceId']} before replacement.")
        return {**observe(record, path), "reused": True}
    timeout = request.get("timeoutSeconds", 15)
    if type(timeout) not in [int, float] or not 1 <= timeout <= 30:
        raise Refused("timeoutSeconds must be between 1 and 30")
    port = choose_port(config, root)
    instance = uuid.uuid4().hex
    record = {"serviceId": service, "instanceId": instance, "unit": f"{service}-{instance}.service",
              "workspace": workspace, "spec": spec, "port": port, "createdAt": time.time()}
    save(path, record)  # Write intent BEFORE the external side effect. Never blindly replay it.
    command = [arg.replace("{port}", str(port)) for arg in spec["command"]]
    try:
        run(["systemd-run", "--user", f"--unit={record['unit']}", "--service-type=exec",
             "--remain-after-exit", "--expand-environment=no",
             f"--working-directory={workspace}", "--property=Restart=no", "--property=KillMode=control-group",
             "--property=TimeoutStopSec=5s", "--property=NoNewPrivileges=yes",
             "--property=StandardOutput=journal", "--property=StandardError=journal",
             "--property=LogRateLimitIntervalSec=10s", "--property=LogRateLimitBurst=100",
             "--", "/usr/bin/env", "-i", f"PATH={spec['path']}", f"PORT={port}",
             *[f"{key}={value}" for key, value in sorted(spec["env"].items())], *command])
    except (Refused, subprocess.TimeoutExpired) as error:
        return {**observe(record, path), "launchError": str(error), "reused": False}
    deadline = time.monotonic() + timeout
    while True:
        result = observe(record, path)
        if result["ready"] or result["state"].get("ActiveState") in ["failed", "inactive"] or time.monotonic() >= deadline:
            return {**result, "reused": False}
        time.sleep(0.1)


def main():
    os.umask(0o077)
    request = json.loads(sys.stdin.read(65537))
    root = Path(os.environ.get("PIANO_PREVIEW_STATE", str(Path.home() / ".local/state/piano/previews")))
    config_path = os.environ.get("PIANO_PREVIEW_CONFIG")
    config = json.loads(Path(config_path).read_text()) if config_path else {}
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / "lock").open("a") as lock:
        deadline = time.monotonic() + 65
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Refused("Preview operation busy. Re-observe status before retrying; no launch attempted.")
                time.sleep(0.1)
        return handle(request, root, config)


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except (Refused, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)

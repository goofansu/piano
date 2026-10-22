"""Contract checks with a fake supervisor boundary, no real services or credentials."""
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("preview", Path(__file__).parents[1] / "scripts/preview.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Preview(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.config = {"origin": "https://test.exe.xyz"}
        self.request = {"action": "start", "workspace": str(self.workspace), "command": ["/bin/false"]}
        self.launches = []
        self.stops = []
        self.journal = "failed command"
        self.state = {"ActiveState": "failed", "InvocationID": "original", "ControlGroup": "/owned"}
        self.addCleanup(patch.stopall)
        patch.object(p, "supervisor", return_value="/user.slice/manager").start()
        patch.object(p, "unit_state", side_effect=lambda _: self.state).start()
        patch.object(p, "run", side_effect=self.command).start()

    def command(self, args, **_):
        if args[0] == "journalctl":
            return self.journal
        if args[0] == "systemd-run":
            # The external side effect must never precede durable intent.
            self.assertEqual(len(list(self.root.glob("*.json"))), 1)
            self.launches.append(args)
        if "stop" in args:
            self.stops.append(args)
        return ""

    def call(self, **changes):
        return p.handle({**self.request, **changes}, self.root, self.config)

    def test_identity_reuse_changed_spec_and_stale_stop(self):
        first = self.call()
        self.assertFalse(first["ready"])
        second = self.call()
        self.assertEqual(first["instanceId"], second["instanceId"])
        self.assertTrue(second["reused"])
        self.assertEqual(len(self.launches), 1)
        with self.assertRaisesRegex(p.Refused, "Launch spec changed"):
            self.call(command=["/bin/true"])
        self.assertFalse(self.call(action="stop", instanceId="stale")["stopped"])
        self.assertFalse(self.stops)
        self.assertTrue(self.call(action="stop", instanceId=first["instanceId"])["stopped"])
        replacement = self.call()
        self.assertEqual(first["serviceId"], replacement["serviceId"])
        self.assertNotEqual(first["instanceId"], replacement["instanceId"])
        self.assertFalse(self.call(action="stop", instanceId=first["instanceId"])["stopped"])
        self.assertEqual(len(self.stops), 1)

    def test_uncertain_submission_is_not_replayed(self):
        with patch.object(p, "run", side_effect=p.Refused("lost acknowledgement")):
            first = self.call()
        self.assertIn("lost acknowledgement", first["launchError"])
        second = self.call()
        self.assertEqual(first["instanceId"], second["instanceId"])
        self.assertFalse(self.launches)

    @unittest.skipUnless(sys.platform == "linux", "Linux /proc listener ownership")
    def test_listener_not_owned_cannot_establish_readiness(self):
        server = socket.socket()
        self.addCleanup(server.close)
        server.bind(("127.0.0.1", 0))
        server.listen()
        first = self.call()
        record_file = next(self.root.glob("*.json"))
        record = json.loads(record_file.read_text())
        record["port"] = server.getsockname()[1]
        p.save(record_file, record)
        self.state = {"ActiveState": "active", "InvocationID": "original", "ControlGroup": "/not-our-cgroup"}
        status = self.call(action="status")
        self.assertFalse(status["ready"])
        self.assertIsNone(status["url"])
        self.assertEqual(first["instanceId"], status["instanceId"])

    def test_collision_reservations_and_unavailable_supervisor(self):
        server = socket.socket()
        self.addCleanup(server.close)
        for port in range(9400, 9500):
            try:
                server.bind(("127.0.0.1", port))
                break
            except OSError:
                continue
        server.listen()
        self.config["ports"] = [port, 8000, 8001, 7070, 9999]
        self.config["reservedPorts"] = [9999]
        with self.assertRaisesRegex(p.Refused, "No free supported"):
            self.call()
        with patch.object(p, "supervisor", side_effect=p.Refused("user manager unavailable")):
            with self.assertRaisesRegex(p.Refused, "unavailable"):
                self.call()
        self.assertFalse(self.launches)
        self.assertFalse(list(self.root.glob("*.json")))

    def test_invocation_change_refuses_stop(self):
        first = self.call()
        self.state = {**self.state, "InvocationID": "replacement"}
        with self.assertRaisesRegex(p.Refused, "invocation changed"):
            self.call(action="stop", instanceId=first["instanceId"])
        self.assertFalse(self.stops)

    def test_environment_is_explicit_and_output_omits_values(self):
        self.journal = "systemd argv: APP_TOKEN=secret"
        result = self.call(env={"APP_TOKEN": "secret"})
        self.assertEqual(result["spec"]["env"], ["APP_TOKEN"])
        self.assertNotIn("secret", result["logs"])
        self.assertIn("[redacted]", result["logs"])
        args = self.launches[0]
        self.assertIn("-i", args)
        self.assertIn("APP_TOKEN=secret", args)
        self.assertIn("--property=Restart=no", args)
        self.assertIn("--property=KillMode=control-group", args)


if __name__ == "__main__":
    unittest.main()

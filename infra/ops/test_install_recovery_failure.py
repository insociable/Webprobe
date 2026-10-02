"""Regression: partial restoration must revoke the privileged delegation."""

import argparse
import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import install_webprobe_ops as installer
import webprobe_ops as helper_module


class RecoveryFailureTests(unittest.TestCase):
    def test_partial_legacy_restore_keeps_delegation_revoked(self):
        helper = installer.HELPER
        unit = pathlib.Path("/protected/backup.service")
        targets = (helper, unit, installer.SUDOERS)
        state = pathlib.Path("/protected/state")
        name = "install-20261002T000000Z-0123456789abcdef"
        old = (b"legacy helper", b"legacy unit", installer.RULE)
        new = (b"safe helper", b"safe unit", installer.RULE)
        records = dict(zip(targets, new))
        metadata = {
            "version": installer.VERSION,
            "previous": {str(p): installer.digest(c) for p, c in zip(targets, old)},
            "new": {str(p): installer.digest(c) for p, c in zip(targets, new)},
            "old_modes": [0o755, 0o644, 0o440],
        }

        def read(path, **kwargs):
            if path == state / name / "install.json":
                return json.dumps(metadata).encode()
            for index, content in enumerate(old):
                if path == state / name / f"old-{index}":
                    return content
            return records.get(path)

        def write(path, content, mode=0o644):
            if path == unit:
                raise installer.OpsError("simulated_restore_write_failure")
            records[path] = content

        with patch.object(installer, "ALL_TARGETS", targets), \
                patch.object(installer, "STATE_DIR", state), \
                patch.object(installer, "secure_dir", side_effect=lambda *a, **kw: os.open(os.devnull, os.O_RDONLY)), \
                patch.object(installer, "protected_read", side_effect=read), \
                patch.object(installer, "protected_write", side_effect=write), \
                patch.object(installer, "protected_unlink", side_effect=lambda p: records.pop(p, None)), \
                patch.object(installer, "run", return_value=""):
            with self.assertRaisesRegex(installer.OpsError, "simulated_restore_write_failure"):
                installer.restore_snapshot(name, require_new=False)

        self.assertEqual(records[helper], old[0])
        self.assertNotIn(installer.SUDOERS, records)

    def install_with_records(self, *, fail_probe=False):
        targets = (installer.HELPER, installer.SUDOERS, installer.INSTALL_MANIFEST)
        new = {installer.HELPER: b"safe helper", installer.SUDOERS: installer.RULE,
               installer.INSTALL_MANIFEST: b"safe manifest"}
        records = {installer.HELPER: b"legacy helper", installer.SUDOERS: installer.RULE}
        events = []

        def write(path, content, mode=0o644):
            if path != installer.SUDOERS:
                self.assertNotIn(installer.SUDOERS, records)
            records[path] = content
            events.append(("write", path))

        def command(argv):
            events.append(tuple(argv))
            if argv == ["/usr/bin/systemctl", "daemon-reload"]:
                self.assertNotIn(installer.SUDOERS, records)
            if argv[-1] == "version":
                if fail_probe:
                    raise installer.OpsError("simulated_probe_failure")
                return json.dumps({"version": installer.VERSION})
            return ""

        with contextlib.ExitStack() as stack:
            mocks = {
                "ALL_TARGETS": targets,
                "payload": lambda args: new,
                "validate_sudoers": lambda: None,
                "require_idle": lambda: None,
                "expected_current": lambda path: {},
                "secure_dir": lambda *a, **kw: os.open(os.devnull, os.O_RDONLY),
                "snapshot": lambda previous, payload: "isolated-test-state",
                "protected_write": write,
                "protected_unlink": lambda path: records.pop(path, None),
                "run": command,
            }
            for name, value in mocks.items():
                stack.enter_context(patch.object(installer, name, value))
            stack.enter_context(patch.object(installer, "restore_snapshot",
                                            side_effect=installer.OpsError("simulated_corrupt_snapshot")))
            args = argparse.Namespace(expected_current=pathlib.Path("/root/expected.json"))
            if fail_probe:
                with self.assertRaisesRegex(installer.OpsError, "install_failed_recovery_incomplete"):
                    installer.install(args)
            else:
                self.assertEqual(installer.install(args), "isolated-test-state")
        return records, events

    def test_delegation_is_published_after_units_and_manifest(self):
        records, events = self.install_with_records()
        self.assertIn(installer.SUDOERS, records)
        writes = [event[1] for event in events if event[0] == "write"]
        self.assertEqual(writes[-1], installer.SUDOERS)
        self.assertLess(events.index(("/usr/bin/systemctl", "daemon-reload")),
                        events.index(("write", installer.SUDOERS)))

    def test_failed_probe_and_failed_recovery_leave_no_delegation(self):
        records, events = self.install_with_records(fail_probe=True)
        self.assertNotIn(installer.SUDOERS, records)
        self.assertEqual(records[installer.HELPER], b"safe helper")

    @unittest.skipIf(helper_module.fcntl is None, "Linux flock boundary")
    def test_helper_and_installer_reject_shared_lock_contention(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            root = pathlib.Path(temporary)
            real_fstat = os.fstat

            def fstat(fd):
                info = real_fstat(fd)
                return SimpleNamespace(st_mode=info.st_mode, st_uid=0)

            stack.enter_context(patch.object(helper_module, "STATE_DIR", root))
            stack.enter_context(patch.object(helper_module, "secure_dir",
                                            side_effect=lambda *a, **kw: os.open(root, os.O_RDONLY)))
            stack.enter_context(patch.object(helper_module.os, "fstat", side_effect=fstat))
            stack.enter_context(patch.object(helper_module.os, "geteuid", return_value=0))
            install = stack.enter_context(patch.object(installer, "install"))
            execute = stack.enter_context(patch.object(helper_module.Ops, "execute"))
            with helper_module.operation_lock():
                for module, argv in ((installer, ["installer", "--install"]),
                                     (helper_module, ["helper", "status"])):
                    errors = io.StringIO()
                    with patch.object(module.sys, "argv", argv), contextlib.redirect_stderr(errors):
                        self.assertEqual(module.main(), 1)
                    self.assertIn("operation_in_progress", errors.getvalue())
            install.assert_not_called()
            execute.assert_not_called()

    @unittest.skipIf(helper_module.fcntl is None, "Linux flock boundary")
    def test_version_probe_does_not_acquire_operation_lock(self):
        output = io.StringIO()
        with patch.object(helper_module.os, "geteuid", return_value=0), \
                patch.object(helper_module.sys, "argv", ["helper", "version"]), \
                patch.object(helper_module, "operation_lock", side_effect=AssertionError("must not acquire")), \
                contextlib.redirect_stdout(output):
            self.assertEqual(helper_module.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"version": helper_module.VERSION})


if __name__ == "__main__":
    unittest.main()

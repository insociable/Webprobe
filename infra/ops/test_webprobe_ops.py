"""Isolated, non-root checks for the privileged-operation boundary."""

import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import webprobe_ops as module


class FakeOps(module.Ops):
    def __init__(self, root: pathlib.Path, *, fail_once: tuple[str, str] | None = None):
        self.events: list[tuple[str, ...]] = []
        self.fail_once = fail_once
        super().__init__(
            state=root / "state", service_dir=root / "systemd", backups=root / "backups",
            scopes={"preproduction": module.Scope(("web.service", "worker.service"),
                                                    root / "releases", root / "app.env", 3100)},
        )

    def systemctl(self, verb: str, *units: str) -> None:
        event = (verb, *units)
        self.events.append(event)
        if self.fail_once == (verb, units[0] if units else ""):
            self.fail_once = None
            raise module.OpsError("simulated_systemctl_failure")

    def show(self, unit: str, prop: str) -> str:
        return {"User": "vboxuser", "Group": "vboxuser", "ActiveState": "active"}.get(prop, "")

    def ready(self, port: int) -> None:
        self.events.append(("ready", str(port)))

    def _release_preflight(self, scope_name: str, name: str, expected: str) -> pathlib.Path:
        return self.scopes[scope_name].releases / name

    def _snapshot(self, scope_name: str, expected: str, new_dropins: tuple[bytes, bytes]) -> str:
        return "preproduction-20261002T000000Z-0123456789abcdef"

    def _load_snapshot(self, scope_name: str, name: str, *, require_current: bool) -> list[bytes | None]:
        return [b"old-web", b"old-worker"]

    def _no_active_scans(self, release: pathlib.Path, env_path: pathlib.Path) -> None:
        self.events.append(("scan-check",))


class OpsBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.files: dict[pathlib.Path, bytes] = {}
        self.write_patch = patch.object(module, "protected_write", side_effect=self.write)
        self.unlink_patch = patch.object(module, "protected_unlink", side_effect=self.unlink)
        self.write_patch.start()
        self.unlink_patch.start()
        self.addCleanup(self.write_patch.stop)
        self.addCleanup(self.unlink_patch.stop)

    def write(self, path: pathlib.Path, content: bytes, mode: int = 0o644) -> None:
        self.files[path] = content

    def unlink(self, path: pathlib.Path) -> None:
        self.files.pop(path, None)

    def test_activation_success_changes_only_fixed_dropins(self):
        ops = FakeOps(self.root)
        result = ops.activate("preproduction", "release-1", "a" * 40)
        self.assertEqual(result["rollbackState"], "preproduction-20261002T000000Z-0123456789abcdef")
        self.assertEqual([event[0] for event in ops.events],
                         ["stop", "stop", "scan-check", "daemon-reload", "start", "start", "ready"])
        self.assertEqual(set(self.files), set(ops.dropins(ops.scopes["preproduction"])))
        self.assertIn(b"User=vboxuser", next(iter(self.files.values())))

    def test_partial_stop_restores_both_dropins_and_restarts_both_units(self):
        ops = FakeOps(self.root, fail_once=("stop", "worker.service"))
        with self.assertRaisesRegex(module.OpsError, "activation_failed_previous_restored"):
            ops.activate("preproduction", "release-1", "a" * 40)
        web, worker = ops.dropins(ops.scopes["preproduction"])
        self.assertEqual(self.files, {web: b"old-web", worker: b"old-worker"})
        self.assertIn(("restart", "web.service"), ops.events)
        self.assertIn(("restart", "worker.service"), ops.events)

    def test_failed_start_restores_previous_configuration(self):
        ops = FakeOps(self.root, fail_once=("start", "worker.service"))
        with self.assertRaisesRegex(module.OpsError, "activation_failed_previous_restored"):
            ops.activate("preproduction", "release-1", "a" * 40)
        self.assertEqual(list(self.files.values()), [b"old-web", b"old-worker"])
        self.assertIn(("daemon-reload",), ops.events)

    def test_wrong_scope_snapshot_is_rejected_before_stop(self):
        ops = FakeOps(self.root)
        ops._load_snapshot = module.Ops._load_snapshot.__get__(ops, FakeOps)
        name = "preproduction-20261002T000000Z-0123456789abcdef"
        wrong = {"scope": "production", "units": ["web.service", "worker.service"],
                 "version": module.VERSION, "files": [None, None]}

        def read(path, **kwargs):
            if path.name == "previous.json":
                return json.dumps(wrong).encode()
            return None

        with patch.object(module, "secure_dir", return_value=os.open(os.devnull, os.O_RDONLY)):
            with patch.object(module, "protected_read", side_effect=read):
                with self.assertRaisesRegex(module.OpsError, "rollback_scope_mismatch"):
                    ops.restore("preproduction", name)
        self.assertEqual(ops.events, [])

    def test_stale_rollback_snapshot_is_rejected_before_stop(self):
        ops = FakeOps(self.root)
        ops._load_snapshot = module.Ops._load_snapshot.__get__(ops, FakeOps)
        name = "preproduction-20261002T000000Z-0123456789abcdef"
        metadata = {"scope": "preproduction", "units": ["web.service", "worker.service"],
                    "version": module.VERSION, "files": [None, None],
                    "new_files": ["a" * 64, "b" * 64]}

        def read(path, **kwargs):
            if path.name == "previous.json":
                return json.dumps(metadata).encode()
            return None

        with patch.object(module, "secure_dir", return_value=os.open(os.devnull, os.O_RDONLY)):
            with patch.object(module, "protected_read", side_effect=read):
                with self.assertRaisesRegex(module.OpsError, "rollback_state_not_current"):
                    ops.restore("preproduction", name)
        self.assertEqual(ops.events, [])

    def test_rollback_refuses_root_application_identity_before_stop(self):
        ops = FakeOps(self.root)
        ops.show = lambda unit, prop: "root" if prop == "User" else "vboxuser"
        with self.assertRaisesRegex(module.OpsError, "unexpected_service_identity"):
            ops.restore("preproduction", "preproduction-20261002T000000Z-0123456789abcdef")
        self.assertEqual(ops.events, [])

    def test_malformed_release_name_is_rejected_before_service_access(self):
        ops = FakeOps(self.root)
        # Exercise the real argument boundary, rather than FakeOps._release_preflight.
        ops._release_preflight = module.Ops._release_preflight.__get__(ops, FakeOps)
        with self.assertRaisesRegex(module.OpsError, "release_or_sha_invalid"):
            ops.activate("preproduction", "../other", "a" * 40)
        self.assertEqual(ops.events, [])

    def test_backup_install_mismatch_refuses_before_start(self):
        ops = FakeOps(self.root)
        manifest = {"version": module.VERSION,
                    "files": {str(path): "0" * 64 for path in module.BACKUP_FILES}}

        def read(path, **kwargs):
            return json.dumps(manifest).encode() if path.name == "installed.json" else b"not expected"

        with patch.object(module, "protected_read", side_effect=read):
            with self.assertRaisesRegex(module.OpsError, "backup_install_hash_mismatch"):
                ops.execute(["backup"])
        self.assertEqual(ops.events, [])


@unittest.skipUnless(os.name == "posix", "Linux dirfd and O_NOFOLLOW required")
class ProtectedFileTests(unittest.TestCase):
    def test_symlink_file_is_not_read_or_exported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "secret").write_bytes(b"secret")
            (root / "link").symlink_to(root / "secret")
            original = module.secure_dir

            def test_dir(path, *, create=False):
                if path == root:
                    return os.open(path, os.O_RDONLY | os.O_DIRECTORY)
                return original(path, create=create)

            with patch.object(module, "secure_dir", side_effect=test_dir):
                with self.assertRaises(OSError):
                    module.protected_read(root / "link")

    def test_archive_selection_skips_non_age_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "webprobe-20261002T000000Z.tar.age").write_bytes(b"not age ciphertext" * 3)
            with patch.object(module, "secure_dir", return_value=os.open(root, os.O_RDONLY | os.O_DIRECTORY)):
                with self.assertRaisesRegex(module.OpsError, "encrypted_archive_missing"):
                    module.Ops(backups=root).backup_fd()


if __name__ == "__main__":
    unittest.main()

"""Update and rollback controls without touching a real systemd instance."""

import json
import os
import pathlib
import unittest
from unittest.mock import patch

import install_webprobe_ops as installer


class InstallerTests(unittest.TestCase):
    def test_backup_config_rejects_environment_injection(self):
        with self.assertRaisesRegex(installer.OpsError, "artifacts_path_invalid"):
            installer.backup_environment("/srv/data\nBASH_ENV=/tmp/evil", "postgres", 14)
        with self.assertRaisesRegex(installer.OpsError, "container_name_invalid"):
            installer.backup_environment("/srv/data", "postgres;id", 14)

    def test_initial_inventory_marks_absent_targets_without_overwriting(self):
        with patch.object(installer, "protected_read", return_value=None):
            inventory = installer.current_manifest()
        self.assertEqual(inventory["version"], "legacy")
        self.assertEqual(set(inventory["files"]), {str(path) for path in installer.ALL_TARGETS})
        self.assertTrue(all(value is None for value in inventory["files"].values()))

    def test_changed_installed_file_refuses_update(self):
        expected = {str(path): None for path in installer.ALL_TARGETS}
        expected[str(installer.HELPER)] = "0" * 64
        input_record = json.dumps({"version": "legacy", "files": expected}).encode()

        def read(path, **kwargs):
            if path == pathlib.Path("/root/expected.json"):
                return input_record
            if path == installer.HELPER:
                return b"unexpected helper"
            return None

        with patch.object(installer, "protected_read", side_effect=read):
            with self.assertRaisesRegex(installer.OpsError, "installed_file_changed"):
                installer.expected_current(pathlib.Path("/root/expected.json"))

    def test_snapshot_rollback_checks_new_hashes_and_revokes_sudo(self):
        first = pathlib.Path("/protected/first")
        targets = (first, installer.SUDOERS)
        state = pathlib.Path("/protected/state")
        name = "install-20261002T000000Z-0123456789abcdef"
        old = b"old content"
        new = b"new content"
        rule = installer.RULE
        records = {first: new, installer.SUDOERS: rule}
        meta = {"version": installer.VERSION,
                "previous": {str(first): installer.digest(old),
                             str(installer.SUDOERS): installer.digest(rule)},
                "new": {str(first): installer.digest(new),
                        str(installer.SUDOERS): installer.digest(rule)},
                "old_modes": [0o600, 0o440]}
        events = []

        def read(path, **kwargs):
            if path == state / name / "install.json":
                return json.dumps(meta).encode()
            if path == state / name / "old-0":
                return old
            if path == state / name / "old-1":
                return rule
            return records.get(path)

        def write(path, data, mode=0o644):
            records[path] = data
            events.append(("write", str(path), mode))

        def unlink(path):
            records.pop(path, None)
            events.append(("unlink", str(path)))

        with patch.object(installer, "ALL_TARGETS", targets), patch.object(installer, "STATE_DIR", state):
            with patch.object(installer, "secure_dir", return_value=os.open(os.devnull, os.O_RDONLY)):
                with patch.object(installer, "protected_read", side_effect=read):
                    with patch.object(installer, "protected_write", side_effect=write):
                        with patch.object(installer, "protected_unlink", side_effect=unlink):
                            with patch.object(installer, "run", side_effect=lambda argv: events.append(tuple(argv)) or ""):
                                installer.restore_snapshot(name, require_new=True)
        self.assertEqual(records[first], old)
        self.assertNotIn(installer.SUDOERS, records)
        self.assertIn(("write", str(first), 0o600), events)
        self.assertIn(("/usr/bin/systemctl", "daemon-reload"), events)

    def test_revoke_removes_rule_even_if_timer_stop_fails(self):
        events = []

        def command(argv):
            events.append(tuple(argv))
            if argv[-1] == installer.TIMERS[0]:
                raise installer.OpsError("simulated")
            return ""

        with patch.object(installer, "run", side_effect=command):
            with patch.object(installer, "protected_unlink", side_effect=lambda path: events.append(("unlink", str(path)))):
                with self.assertRaisesRegex(installer.OpsError, "delegation_revoked_timer_stop_failed"):
                    installer.revoke()
        self.assertIn(("unlink", str(installer.SUDOERS)), events)
        self.assertIn(("/usr/bin/systemctl", "stop", installer.TIMERS[1]), events)


if __name__ == "__main__":
    unittest.main()

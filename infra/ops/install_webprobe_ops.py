#!/usr/bin/python3 -I
"""Review-gated, transactional installation of the narrow WebProbe delegation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import secrets
import stat

# -I intentionally omits the script directory from sys.path. The installer is
# run only from a reviewed, root-owned staging tree (see the operations guide).
sys.path.insert(0, str(pathlib.Path(__file__).absolute().parent))
from webprobe_ops import (
    BACKUP_FILES, CLEAN_ENV, INSTALL_MANIFEST, OpsError, SERVICE_DIR, STATE_DIR,
    VERSION, protected_read, protected_unlink, protected_write, secure_dir,
)


ROOT = pathlib.Path(__file__).absolute().parents[2]
HELPER = pathlib.Path("/usr/local/sbin/webprobe-ops")
SUDOERS = pathlib.Path("/etc/sudoers.d/90-webprobe-ops")
RULE = b"vboxuser ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/webprobe-ops\n"
TIMERS = ("webprobe-backup.timer", "webprobe-backup-restore-check.timer")
JOBS = ("webprobe-backup.service", "webprobe-backup-restore-check.service")
TARGET_SOURCES = {
    HELPER: "infra/ops/webprobe_ops.py",
    pathlib.Path("/usr/local/libexec/webprobe-ops/webprobe-backup.sh"):
        "infra/backup/webprobe-backup.sh",
    pathlib.Path("/usr/local/libexec/webprobe-ops/webprobe-restore-check.sh"):
        "infra/backup/webprobe-restore-check.sh",
    SERVICE_DIR / "webprobe-backup.service": "infra/systemd/webprobe-backup.service",
    SERVICE_DIR / "webprobe-backup-restore-check.service":
        "infra/systemd/webprobe-backup-restore-check.service",
}
BACKUP_ENV = pathlib.Path("/etc/webprobe-backup/backup.env")
ALL_TARGETS = (*TARGET_SOURCES, BACKUP_ENV, SUDOERS, INSTALL_MANIFEST)
INSTALL_STATE_NAME = re.compile(r"install-\d{8}T\d{6}Z-[a-f0-9]{16}\Z")


def digest(content: bytes | None) -> str | None:
    return None if content is None else hashlib.sha256(content).hexdigest()


def run(argv: list[str]) -> str:
    try:
        return subprocess.run(argv, env=CLEAN_ENV, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True, check=True,
                              timeout=120).stdout.strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise OpsError("installation_command_failed") from None


def require_idle() -> None:
    for unit in (*TIMERS, *JOBS):
        if run(["/usr/bin/systemctl", "show", unit, "--property=ActiveState", "--value"]) != "inactive":
            raise OpsError("stop_backup_timers_and_wait_for_jobs_first")


def validate_sudoers() -> None:
    parent = secure_dir(SUDOERS.parent)
    os.close(parent)
    fd, temporary = tempfile.mkstemp(prefix=".webprobe-visudo-", dir=SUDOERS.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(RULE)
        run(["/usr/sbin/visudo", "-c", "-f", temporary])
    finally:
        os.unlink(temporary)


def checked_source() -> dict[pathlib.Path, bytes]:
    # The administrator must first stage the exact reviewed commit under a
    # root-owned tree. This check also refuses a later replacement via symlink.
    source = pathlib.Path(__file__).absolute()
    protected_read(source, limit=1048576)
    protected_read(source.parent / "webprobe_ops.py", limit=1048576)
    return {target: protected_read(ROOT / relative, limit=1048576)
            for target, relative in TARGET_SOURCES.items()}


def backup_environment(artifacts_dir: str, container: str, days: int) -> bytes:
    if (not re.fullmatch(r"/[A-Za-z0-9_./-]+", artifacts_dir)
            or posixpath.normpath(artifacts_dir) != artifacts_dir):
        raise OpsError("artifacts_path_invalid")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container):
        raise OpsError("container_name_invalid")
    if not 1 <= days <= 365:
        raise OpsError("retention_invalid")
    return (f"WEBPROBE_ARTIFACTS_DIR={artifacts_dir}\n"
            f"WEBPROBE_POSTGRES_CONTAINER={container}\n"
            f"WEBPROBE_BACKUP_RETENTION_DAYS={days}\n").encode("ascii")


def payload(args: argparse.Namespace) -> dict[pathlib.Path, bytes]:
    result = checked_source()
    result[BACKUP_ENV] = backup_environment(args.artifacts_dir, args.postgres_container,
                                            args.retention_days)
    result[SUDOERS] = RULE
    manifest = {"version": VERSION,
                "files": {str(path): digest(result[path]) for path in BACKUP_FILES}}
    result[INSTALL_MANIFEST] = json.dumps(manifest, sort_keys=True).encode("ascii")
    return result


def expected_current(path: pathlib.Path) -> dict[str, str | None]:
    record = json.loads(protected_read(path, limit=16384))
    current_version = "legacy"
    current_manifest = protected_read(INSTALL_MANIFEST, missing_ok=True, limit=8192)
    if current_manifest is not None:
        current_version = json.loads(current_manifest).get("version")
    if record.get("version") != current_version:
        raise OpsError("installed_version_unexpected")
    files = record.get("files")
    if not isinstance(files, dict) or set(files) != {str(path) for path in ALL_TARGETS}:
        raise OpsError("expected_file_set_invalid")
    for target in ALL_TARGETS:
        expected = files[str(target)]
        if expected is not None and not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise OpsError("expected_digest_invalid")
        if digest(protected_read(target, missing_ok=True, limit=1048576)) != expected:
            raise OpsError("installed_file_changed")
    return files


def current_manifest() -> dict[str, object]:
    current = protected_read(INSTALL_MANIFEST, missing_ok=True, limit=8192)
    version = "legacy" if current is None else json.loads(current).get("version")
    return {"version": version,
            "files": {str(target): digest(protected_read(target, missing_ok=True,
                                                         limit=1048576)) for target in ALL_TARGETS}}


def snapshot(previous: dict[str, str | None], new: dict[pathlib.Path, bytes]) -> str:
    parent = secure_dir(STATE_DIR)
    name = f"install-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(8)}"
    try:
        os.mkdir(name, mode=0o700, dir_fd=parent)
    finally:
        os.close(parent)
    path = STATE_DIR / name
    old_modes = []
    for index, target in enumerate(ALL_TARGETS):
        content = protected_read(target, missing_ok=True, limit=1048576)
        old_modes.append(None if content is None else stat.S_IMODE(target.stat(follow_symlinks=False).st_mode))
        if content is not None:
            protected_write(path / f"old-{index}", content, 0o600)
    metadata = {"version": VERSION, "previous": previous, "old_modes": old_modes,
                "new": {str(target): digest(new[target]) for target in ALL_TARGETS}}
    protected_write(path / "install.json", json.dumps(metadata, sort_keys=True).encode(), 0o600)
    return name


def restore_snapshot(name: str, *, require_new: bool) -> None:
    if not INSTALL_STATE_NAME.fullmatch(name):
        raise OpsError("install_snapshot_invalid")
    path = STATE_DIR / name
    fd = secure_dir(path)
    os.close(fd)
    metadata = json.loads(protected_read(path / "install.json", limit=16384))
    if metadata.get("version") != VERSION or set(metadata.get("previous", {})) != {
        str(target) for target in ALL_TARGETS
    } or not isinstance(metadata.get("old_modes"), list) or len(metadata["old_modes"]) != len(ALL_TARGETS):
        raise OpsError("install_snapshot_corrupt")
    if require_new:
        if set(metadata.get("new", {})) != {str(target) for target in ALL_TARGETS}:
            raise OpsError("install_snapshot_corrupt")
        for target in ALL_TARGETS:
            if digest(protected_read(target, missing_ok=True, limit=1048576)) != metadata["new"][str(target)]:
                raise OpsError("installed_file_changed")
    old: list[bytes | None] = []
    for index, target in enumerate(ALL_TARGETS):
        content = protected_read(path / f"old-{index}", missing_ok=True, limit=1048576)
        if digest(content) != metadata["previous"][str(target)]:
            raise OpsError("install_snapshot_corrupt")
        mode = metadata["old_modes"][index]
        if (content is None and mode is not None) or (
            content is not None and (not isinstance(mode, int) or mode & 0o022 or mode < 0 or mode > 0o777)
        ):
            raise OpsError("install_snapshot_corrupt")
        old.append(content)
    # The legacy backup units execute mutable root code. Rollback revokes the
    # delegation and leaves timers stopped even if it restores those files.
    for index, (target, content) in enumerate(zip(ALL_TARGETS, old)):
        if target == SUDOERS:
            continue
        if content is None:
            protected_unlink(target)
        else:
            protected_write(target, content, metadata["old_modes"][index])
    protected_unlink(SUDOERS)
    run(["/usr/sbin/visudo", "-c"])
    run(["/usr/bin/systemctl", "daemon-reload"])


def install(args: argparse.Namespace) -> str:
    new = payload(args)
    validate_sudoers()
    require_idle()
    previous = expected_current(args.expected_current)
    state_fd = secure_dir(STATE_DIR, create=True)
    os.close(state_fd)
    state_name = snapshot(previous, new)
    modes = {HELPER: 0o755, SUDOERS: 0o440, BACKUP_ENV: 0o600,
             INSTALL_MANIFEST: 0o600}
    for path in TARGET_SOURCES:
        if path != HELPER and path.suffix == ".sh":
            modes[path] = 0o755
    try:
        for target in ALL_TARGETS:
            protected_write(target, new[target], modes.get(target, 0o644))
        run(["/usr/sbin/visudo", "-c"])
        run(["/usr/bin/systemctl", "daemon-reload"])
        result = run(["/usr/sbin/runuser", "-u", "vboxuser", "--", "/usr/bin/sudo", "-n",
                      str(HELPER), "version"])
        if json.loads(result) != {"version": VERSION}:
            raise OpsError("installed_version_unexpected")
    except Exception:
        try:
            restore_snapshot(state_name, require_new=False)
        except Exception:
            raise OpsError("install_failed_recovery_incomplete:" + state_name) from None
        raise OpsError("install_failed_delegation_revoked:" + state_name) from None
    return state_name


def revoke() -> None:
    failed = False
    for timer in TIMERS:
        try:
            run(["/usr/bin/systemctl", "stop", timer])
        except OpsError:
            failed = True
    protected_unlink(SUDOERS)
    run(["/usr/sbin/visudo", "-c"])
    if failed:
        raise OpsError("delegation_revoked_timer_stop_failed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--install", action="store_true")
    group.add_argument("--rollback-install", metavar="STATE")
    group.add_argument("--revoke", action="store_true")
    group.add_argument("--print-current", action="store_true")
    parser.add_argument("--expected-current", type=pathlib.Path)
    parser.add_argument("--artifacts-dir")
    parser.add_argument("--postgres-container", default="agency-saas-postgres-1")
    parser.add_argument("--retention-days", type=int, default=14)
    args = parser.parse_args()
    try:
        if args.check:
            for relative in TARGET_SOURCES.values():
                source = ROOT / relative
                if source.suffix == ".py":
                    compile(source.read_bytes(), str(source), "exec")
                elif source.suffix == ".sh" and shutil.which("bash"):
                    run([shutil.which("bash"), "-n", str(source)])
            print(json.dumps({"source": "syntax_ok", "version": VERSION}))
            return 0
        if os.geteuid() != 0:
            raise OpsError("root_install_required")
        if args.print_current:
            print(json.dumps(current_manifest(), sort_keys=True, indent=2))
        elif args.install:
            if args.expected_current is None or args.artifacts_dir is None:
                raise OpsError("expected_manifest_and_artifacts_required")
            name = install(args)
            print(json.dumps({"installed": VERSION, "rollbackState": name,
                              "timers": "remain_stopped"}))
        elif args.rollback_install:
            require_idle()
            restore_snapshot(args.rollback_install, require_new=True)
            print(json.dumps({"rollbackState": args.rollback_install,
                              "delegation": "revoked", "timers": "remain_stopped"}))
        else:
            revoke()
            print(json.dumps({"delegation": "revoked", "timers": "stopped"}))
        return 0
    except OpsError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    except Exception:
        print('{"error":"installation_failed"}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

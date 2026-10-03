#!/usr/bin/python3 -I
"""Narrow, auditable WebProbe system operations for the sudoers entry."""

from __future__ import annotations

try:
    import fcntl
except ImportError:  # Allows pure-logic tests on Windows; installed target is Linux.
    fcntl = None
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from contextlib import contextmanager


VERSION = "2026-10-02-v3"
SERVICE_DIR = pathlib.Path("/etc/systemd/system")
STATE_DIR = pathlib.Path("/var/lib/webprobe-ops")
BACKUP_DIR = pathlib.Path("/var/backups/webprobe")
INSTALL_MANIFEST = STATE_DIR / "installed.json"
BACKUP_FILES = (
    pathlib.Path("/usr/local/libexec/webprobe-ops/webprobe-backup.sh"),
    pathlib.Path("/usr/local/libexec/webprobe-ops/webprobe-restore-check.sh"),
    pathlib.Path("/etc/webprobe-backup/backup.env"),
    SERVICE_DIR / "webprobe-backup.service",
    SERVICE_DIR / "webprobe-backup-restore-check.service",
)
BACKUP_UNITS = {
    "backup": "webprobe-backup.service",
    "restore-check": "webprobe-backup-restore-check.service",
}
ARCHIVE_NAME = re.compile(r"webprobe-\d{8}T\d{6}Z\.tar\.age\Z")
RELEASE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
STATE_NAME = re.compile(r"(preproduction|production)-\d{8}T\d{6}Z-[a-f0-9]{16}\Z")
CLEAN_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}


@dataclass(frozen=True)
class Scope:
    units: tuple[str, str]
    releases: pathlib.Path
    env: pathlib.Path
    port: int


SCOPES = {
    "preproduction": Scope(
        ("agency-saas-preprod-web.service", "agency-saas-preprod-worker.service"),
        pathlib.Path("/srv/preprod/releases"),
        pathlib.Path("/srv/preprod/agency-saas/.env"),
        3100,
    ),
    "production": Scope(
        ("agency-saas-web.service", "agency-saas-worker.service"),
        pathlib.Path("/srv/webprobe/releases"),
        pathlib.Path("/srv/agency-saas/.env"),
        3000,
    ),
}


class OpsError(Exception):
    pass


def checked_run(argv: list[str], *, user: bool = False) -> str:
    if user:
        argv = [
            "/usr/sbin/runuser", "-u", "vboxuser", "--", "/usr/bin/env", "-i",
            *[f"{key}={value}" for key, value in CLEAN_ENV.items()],
            "HOME=/home/vboxuser", "USER=vboxuser", *argv,
        ]
    try:
        return subprocess.run(
            argv, env=CLEAN_ENV, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=True, timeout=120,
        ).stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        raise OpsError("subprocess_failed") from None


def secure_dir(path: pathlib.Path, *, create: bool = False) -> int:
    """Open each root-owned path component without following symlinks."""
    if not path.is_absolute():
        raise OpsError("unsafe_path")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            if part in ("", ".", ".."):
                raise OpsError("unsafe_path")
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=fd,
            )
            info = os.fstat(next_fd)
            if info.st_uid != 0 or info.st_mode & 0o022:
                os.close(next_fd)
                raise OpsError("unsafe_directory")
            os.close(fd)
            fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise


def protected_read(path: pathlib.Path, *, missing_ok: bool = False, limit: int = 65536) -> bytes | None:
    try:
        parent = secure_dir(path.parent)
    except FileNotFoundError:
        if missing_ok:
            return None
        raise OpsError("protected_file_missing") from None
    try:
        try:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            if missing_ok:
                return None
            raise OpsError("protected_file_missing") from None
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > limit:
                raise OpsError("unsafe_file")
            return os.read(fd, limit + 1)
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def protected_write(path: pathlib.Path, content: bytes, mode: int = 0o644) -> None:
    parent = secure_dir(path.parent, create=True)
    temporary = f".webprobe-{secrets.token_hex(12)}"
    try:
        protected_read(path, missing_ok=True)
        fd = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            mode, dir_fd=parent,
        )
        try:
            os.fchown(fd, 0, 0)
            os.fchmod(fd, mode)
            with os.fdopen(fd, "wb", closefd=False) as output:
                output.write(content)
                output.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, path.name, src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def protected_unlink(path: pathlib.Path) -> None:
    try:
        parent = secure_dir(path.parent)
    except FileNotFoundError:
        return
    try:
        protected_read(path, missing_ok=True)
        try:
            os.unlink(path.name, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.fsync(parent)
    finally:
        os.close(parent)


@contextmanager
def operation_lock(*, create: bool = False):
    """Serialize helper operations and administrator installation changes."""
    if fcntl is None:
        raise OpsError("operation_lock_requires_linux")
    parent = secure_dir(STATE_DIR, create=create)
    try:
        lock = os.open("operation.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                       0o600, dir_fd=parent)
        try:
            info = os.fstat(lock)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
                raise OpsError("unsafe_lock")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise OpsError("operation_in_progress") from None
            yield
        finally:
            os.close(lock)
    finally:
        os.close(parent)


class Ops:
    def __init__(self, *, state: pathlib.Path = STATE_DIR, service_dir: pathlib.Path = SERVICE_DIR,
                 backups: pathlib.Path = BACKUP_DIR, scopes: dict[str, Scope] = SCOPES):
        self.state = state
        self.service_dir = service_dir
        self.backups = backups
        self.scopes = scopes

    def run(self, argv: list[str], *, user: bool = False) -> str:
        return checked_run(argv, user=user)

    def show(self, unit: str, prop: str) -> str:
        return self.run(["/usr/bin/systemctl", "show", unit, "--property=" + prop, "--value"])

    def systemctl(self, verb: str, *units: str) -> None:
        self.run(["/usr/bin/systemctl", verb, *units])

    def ready(self, port: int) -> None:
        for _ in range(15):
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/health/ready", timeout=2,
                ) as response:
                    data = json.loads(response.read(4096))
                checks = data.get("checks", {})
                required = {"database", "valkey", "worker", "queue", "browser"}
                if data.get("status") == "ready" and required.issubset(checks) and all(
                    value == "up" for value in checks.values()
                ):
                    return
            except (OSError, ValueError, TypeError):
                pass
            time.sleep(1)
        raise OpsError("readiness_failed")

    def dropins(self, scope: Scope) -> tuple[pathlib.Path, pathlib.Path]:
        return tuple(self.service_dir / (unit + ".d") / "95-webprobe-ops.conf" for unit in scope.units)

    def require_app_identity(self, scope: Scope) -> None:
        for unit in scope.units:
            if (self.show(unit, "User"), self.show(unit, "Group")) != ("vboxuser", "vboxuser"):
                raise OpsError("unexpected_service_identity")

    def require_app_units(self, scope: Scope) -> None:
        self.require_app_identity(scope)
        for unit in scope.units:
            if self.show(unit, "ActiveState") != "active":
                raise OpsError("service_not_active")

    def require_backup_install(self) -> None:
        manifest = json.loads(protected_read(self.state / "installed.json", limit=8192))
        if manifest.get("version") != VERSION:
            raise OpsError("backup_install_version_mismatch")
        expected = manifest.get("files", {})
        if set(expected) != {str(path) for path in BACKUP_FILES}:
            raise OpsError("backup_install_manifest_invalid")
        for path in BACKUP_FILES:
            content = protected_read(path, limit=1048576)
            if hashlib.sha256(content).hexdigest() != expected[str(path)]:
                raise OpsError("backup_install_hash_mismatch")
        for unit in BACKUP_UNITS.values():
            if self.show(unit, "FragmentPath") != str(self.service_dir / unit):
                raise OpsError("backup_unit_unexpected")
            if self.show(unit, "DropInPaths"):
                raise OpsError("backup_unit_override")

    def backup_fd(self) -> tuple[int, str]:
        directory = secure_dir(self.backups)
        chosen: tuple[float, int, str] | None = None
        try:
            for name in os.listdir(directory):
                if not ARCHIVE_NAME.fullmatch(name):
                    continue
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
                info = os.fstat(fd)
                valid = (stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                         and not info.st_mode & 0o022 and info.st_size > 20
                         and os.read(fd, 22) == b"age-encryption.org/v1\n")
                if not valid:
                    os.close(fd)
                    continue
                if chosen is None or info.st_mtime > chosen[0]:
                    if chosen:
                        os.close(chosen[1])
                    chosen = (info.st_mtime, fd, name)
                else:
                    os.close(fd)
            if chosen is None:
                raise OpsError("encrypted_archive_missing")
            os.lseek(chosen[1], 0, os.SEEK_SET)
            return chosen[1], chosen[2]
        finally:
            os.close(directory)

    def evidence(self) -> dict[str, object]:
        fd, name = self.backup_fd()
        try:
            info = os.fstat(fd)
            digest = hashlib.sha256()
            while block := os.read(fd, 1024 * 1024):
                digest.update(block)
            return {"archive": name, "bytes": info.st_size, "sha256": digest.hexdigest()}
        finally:
            os.close(fd)

    def export(self) -> None:
        fd, _ = self.backup_fd()
        try:
            while block := os.read(fd, 1024 * 1024):
                remaining = memoryview(block)
                while remaining:
                    remaining = remaining[os.write(sys.stdout.fileno(), remaining):]
        finally:
            os.close(fd)

    def _snapshot(self, scope_name: str, expected: str, new_dropins: tuple[bytes, bytes]) -> str:
        scope = self.scopes[scope_name]
        current = [protected_read(path, missing_ok=True) for path in self.dropins(scope)]
        name = f"{scope_name}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(8)}"
        parent = secure_dir(self.state)
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent)
        finally:
            os.close(parent)
        state_path = self.state / name
        files = []
        for index, content in enumerate(current):
            files.append(None if content is None else hashlib.sha256(content).hexdigest())
            if content is not None:
                protected_write(state_path / f"drop-{index}", content, 0o600)
        metadata = {"scope": scope_name, "units": list(scope.units), "expected": expected,
                    "files": files,
                    "new_files": [hashlib.sha256(content).hexdigest() for content in new_dropins],
                    "version": VERSION}
        protected_write(state_path / "previous.json", json.dumps(metadata, sort_keys=True).encode(), 0o600)
        return name

    def _load_snapshot(self, scope_name: str, name: str, *, require_current: bool) -> list[bytes | None]:
        if not STATE_NAME.fullmatch(name) or not name.startswith(scope_name + "-"):
            raise OpsError("rollback_state_invalid")
        state_path = self.state / name
        directory = secure_dir(state_path)
        os.close(directory)
        metadata = json.loads(protected_read(state_path / "previous.json", limit=4096))
        scope = self.scopes[scope_name]
        if (metadata.get("scope") != scope_name or metadata.get("units") != list(scope.units)
                or metadata.get("version") != VERSION or not isinstance(metadata.get("files"), list)
                or len(metadata["files"]) != 2 or not isinstance(metadata.get("new_files"), list)
                or len(metadata["new_files"]) != 2):
            raise OpsError("rollback_scope_mismatch")
        result = []
        for index, digest in enumerate(metadata["files"]):
            content = protected_read(state_path / f"drop-{index}", missing_ok=True, limit=16384)
            if (digest is None and content is not None) or (
                digest is not None and (content is None or hashlib.sha256(content).hexdigest() != digest)
            ):
                raise OpsError("rollback_state_corrupt")
            result.append(content)
        if require_current:
            current = [protected_read(path, missing_ok=True) for path in self.dropins(scope)]
            if [None if content is None else hashlib.sha256(content).hexdigest()
                for content in current] != metadata["new_files"]:
                raise OpsError("rollback_state_not_current")
        return result

    def restore(self, scope_name: str, name: str, *, require_current: bool = True) -> None:
        scope = self.scopes[scope_name]
        previous = self._load_snapshot(scope_name, name, require_current=require_current)
        self.require_app_identity(scope)
        errors = []
        for unit in scope.units:
            try:
                self.systemctl("stop", unit)
            except OpsError:
                errors.append("stop")
        for path, content in zip(self.dropins(scope), previous):
            try:
                if content is None:
                    protected_unlink(path)
                else:
                    protected_write(path, content)
            except (OpsError, OSError):
                errors.append("restore_file")
        try:
            self.systemctl("daemon-reload")
        except OpsError:
            errors.append("reload")
        for unit in scope.units:
            try:
                self.systemctl("restart", unit)
            except OpsError:
                errors.append("restart")
        try:
            self.ready(scope.port)
        except OpsError:
            errors.append("readiness")
        if errors:
            raise OpsError("rollback_incomplete:" + ",".join(errors))

    def _release_preflight(self, scope_name: str, name: str, expected: str) -> pathlib.Path:
        if not RELEASE_NAME.fullmatch(name) or not re.fullmatch(r"[a-f0-9]{40}", expected):
            raise OpsError("release_or_sha_invalid")
        scope = self.scopes[scope_name]
        release = scope.releases / name
        if not release.is_dir() or release.is_symlink() or release.resolve() != release:
            raise OpsError("release_path_invalid")
        if self.run(["/usr/bin/git", "-C", str(release), "rev-parse", "HEAD"], user=True) != expected:
            raise OpsError("release_sha_mismatch")
        if self.run(["/usr/bin/git", "-C", str(release), "status", "--porcelain"], user=True):
            raise OpsError("release_dirty")
        for relative in ("apps/web/.next/BUILD_ID", "apps/web/node_modules/next/dist/bin/next",
                         "apps/worker/dist/index.js"):
            if not (release / relative).is_file():
                raise OpsError("release_artifact_missing")
        self.require_app_units(scope)
        for path in self.dropins(scope):
            fd = secure_dir(path.parent, create=True)  # must be protected before stop
            os.close(fd)
            protected_read(path, missing_ok=True)
        fd = secure_dir(self.state)
        os.close(fd)
        self._no_active_scans(release, scope.env)
        return release

    def _no_active_scans(self, release: pathlib.Path, env_path: pathlib.Path) -> None:
        # Node and project dependencies run *only* as vboxuser. The .env is parsed as data.
        check = (
            "import fs from 'node:fs';import {parseEnv} from 'node:util';"
            "import {createRequire} from 'node:module';"
            f"const root={json.dumps(str(release))},env=parseEnv(fs.readFileSync({json.dumps(str(env_path))},'utf8'));"
            "const postgres=createRequire(root+'/packages/db/package.json')('postgres');"
            "const db=postgres(env.DATABASE_URL,{max:1});"
            "try{const [row]=await db`select count(*)::int as n from scans where status in ('queued','running')`;"
            "if(row.n!==0)throw new Error('active scans');}finally{await db.end();}"
        )
        self.run(["/usr/bin/node", "--input-type=module", "-e", check], user=True)

    def activate(self, scope_name: str, name: str, expected: str) -> dict[str, str]:
        scope = self.scopes[scope_name]
        release = self._release_preflight(scope_name, name, expected)
        web = ("[Service]\nUser=vboxuser\nGroup=vboxuser\n"
               f"WorkingDirectory={release / 'apps/web'}\nExecStart=\n"
               f"ExecStart=/usr/bin/node {release / 'apps/web/node_modules/next/dist/bin/next'} "
               f"start --hostname 127.0.0.1 --port {scope.port}\n")
        worker = ("[Service]\nUser=vboxuser\nGroup=vboxuser\n"
                  f"WorkingDirectory={release}\nExecStart=\n"
                  f"ExecStart=/usr/bin/node {release / 'apps/worker/dist/index.js'}\n")
        state_name = self._snapshot(scope_name, expected, (web.encode(), worker.encode()))
        try:
            for unit in scope.units:
                self.systemctl("stop", unit)
            self._no_active_scans(release, scope.env)
            for path, content in zip(self.dropins(scope), (web, worker)):
                protected_write(path, content.encode())
            self.systemctl("daemon-reload")
            for unit in scope.units:
                self.systemctl("start", unit)
            self.ready(scope.port)
        except Exception:
            try:
                self.restore(scope_name, state_name, require_current=False)
            except Exception:
                raise OpsError("activation_failed_recovery_incomplete:" + state_name) from None
            raise OpsError("activation_failed_previous_restored:" + state_name) from None
        return {"scope": scope_name, "sha": expected, "release": str(release),
                "rollbackState": state_name, "ready": "yes"}

    def execute(self, args: list[str]) -> object:
        if args == ["version"]:
            return {"version": VERSION}
        if args == ["status"]:
            result = {}
            for scope in self.scopes.values():
                for unit in scope.units:
                    pid = self.show(unit, "MainPID")
                    result[unit] = {"active": self.show(unit, "ActiveState"), "pid": int(pid)}
            return result
        if len(args) == 1 and args[0] in BACKUP_UNITS:
            self.require_backup_install()
            unit = BACKUP_UNITS[args[0]]
            self.systemctl("start", unit)
            if self.show(unit, "Result") != "success" or self.show(unit, "ExecMainStatus") != "0":
                raise OpsError("backup_job_failed")
            return {"unit": unit, "result": "success"}
        if args == ["backup-evidence"]:
            return self.evidence()
        if args == ["export-backup"]:
            self.export()
            return None
        if len(args) == 2 and args[0] == "restart" and args[1] in self.scopes:
            scope = self.scopes[args[1]]
            self.require_app_units(scope)
            for unit in scope.units:
                self.systemctl("restart", unit)
            self.ready(scope.port)
            return {"scope": args[1], "ready": "yes"}
        if len(args) == 3 and args[0] == "rollback" and args[1] in self.scopes:
            self.restore(args[1], args[2])
            return {"scope": args[1], "rollbackState": args[2], "ready": "yes"}
        if len(args) == 4 and args[0] == "activate" and args[1] in self.scopes:
            return self.activate(args[1], args[2], args[3])
        raise OpsError("unsupported_action")


def main() -> int:
    if os.geteuid() != 0:
        print('{"error":"root_via_narrow_sudo_required"}', file=sys.stderr)
        return 1
    os.umask(0o077)
    try:
        # Installation checks the new sudoers rule while holding the same lock.
        # Version only reports this executable's constant and changes no state.
        if sys.argv[1:] == ["version"]:
            print(json.dumps({"version": VERSION}))
            return 0
        with operation_lock():
            result = Ops().execute(sys.argv[1:])
            if result is not None:
                print(json.dumps(result, sort_keys=True))
            return 0
    except OpsError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    except Exception:
        print('{"error":"operation_failed"}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

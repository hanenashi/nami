#!/usr/bin/env python3
"""Take a consistent pilot snapshot, then send it to the encrypted remote repo."""

import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone


REPO = Path(__file__).resolve().parents[1]
DATA = REPO.parent / "nami-pilot-data"
SNAPSHOTS = REPO.parent / "nami-pilot-backups"
RESTIC_REPOSITORY = "sftp:kurochan:NAMI-backups/pilot"
PASSWORD_FILE = Path.home() / ".config/nami/restic-pilot-password"
COMPOSE = ["docker", "compose", "-f", "compose.pilot.yaml"]


def run(*args: str, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=REPO, env=env, check=True)


def verify_snapshot(path: Path) -> tuple[int, int]:
    if any(p.is_symlink() for p in path.rglob("*")):
        raise RuntimeError("Pilot data contains a symlink; snapshot needs review")
    db = sqlite3.connect(f"file:{path / 'db/nami.sqlite'}?mode=ro", uri=True)
    try:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("SQLite foreign key check failed")
        photos = db.execute("SELECT id, sha256 FROM media").fetchall()
    finally:
        db.close()
    for photo_id, expected in photos:
        original = path / "originals" / f"{photo_id}.jpg"
        preview = path / "previews" / f"{photo_id}.jpg"
        if not original.is_file() or not preview.is_file():
            raise RuntimeError(f"Stored photo is missing: {photo_id}")
        with original.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != expected:
            raise RuntimeError(f"Original hash mismatch: {photo_id}")
    files = [p for p in sorted(path.rglob("*")) if p.is_file() and not p.is_symlink()]
    manifest = path / "manifest.sha256"
    with manifest.open("x") as stream:
        for file in files:
            with file.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            stream.write(f"{digest}  {file.relative_to(path).as_posix()}\n")
    manifest.chmod(0o600)
    return len(photos), len(files)


def main() -> None:
    if not DATA.is_dir() or not PASSWORD_FILE.is_file():
        raise RuntimeError("Pilot data or protected Restic password file is missing")
    if PASSWORD_FILE.stat().st_mode & 0o077:
        raise RuntimeError("Restic password file must be private (mode 0600)")
    SNAPSHOTS.mkdir(mode=0o700, exist_ok=True)
    SNAPSHOTS.chmod(0o700)
    lock_path = SNAPSHOTS / ".backup.lock"
    with lock_path.open("a+") as lock:
        lock_path.chmod(0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        snapshot = SNAPSHOTS / f"private-pilot-{stamp}"
        partial = SNAPSHOTS / f".private-pilot-{stamp}.partial"
        if snapshot.exists() or partial.exists():
            raise RuntimeError("Backup destination already exists")

        print("Pausing pilot app for a consistent copy", flush=True)
        run(*COMPOSE, "stop", "nami")
        try:
            shutil.copytree(DATA, partial, symlinks=True)
            photo_count, file_count = verify_snapshot(partial)
            partial.rename(snapshot)
        finally:
            print("Restarting pilot app", flush=True)
            run(*COMPOSE, "up", "-d", "--no-build", "--wait")

        env = os.environ.copy()
        env["RESTIC_PASSWORD_FILE"] = str(PASSWORD_FILE)
        print("Sending verified snapshot to encrypted Kurochan repository", flush=True)
        run("restic", "-r", RESTIC_REPOSITORY, "backup", str(snapshot), "--tag", "nami-pilot", env=env)
        run("restic", "-r", RESTIC_REPOSITORY, "check", env=env)
        print(f"Backup complete: {snapshot.name}; {photo_count} originals; {file_count} manifest files", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Pilot backup failed: {exc}", file=sys.stderr)
        sys.exit(1)

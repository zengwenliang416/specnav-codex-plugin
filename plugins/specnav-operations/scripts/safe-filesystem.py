#!/usr/bin/env python3
"""Descriptor-relative filesystem operations for SpecNav release/archive proof."""

import base64
import errno
import json
import os
import secrets
import stat
import sys
import time


NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
DIRECTORY = getattr(os, "O_DIRECTORY", 0)
UNSET = object()


class GuardError(Exception):
    pass


def fail(blocker, reason):
    raise GuardError(f"{blocker}:{reason}")


def parts(relative, blocker, allow_root=False):
    if not isinstance(relative, str) or relative == "":
        fail(blocker, "path-escape")
    if relative == "." and allow_root:
        return []
    if (
        os.path.isabs(relative)
        or "\\" in relative
        or relative.strip() != relative
    ):
        fail(blocker, "path-escape")
    value = relative.split("/")
    if any(segment in ("", ".", "..") for segment in value):
        fail(blocker, "path-escape")
    return value


def identity(fd):
    value = os.fstat(fd)
    return (value.st_dev, value.st_ino)


def open_root(root, blocker):
    try:
        fd = os.open(root, os.O_RDONLY | DIRECTORY | NOFOLLOW)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail(blocker, "symlink")
        fail(blocker, "root-invalid")
    if not stat.S_ISDIR(os.fstat(fd).st_mode):
        os.close(fd)
        fail(blocker, "root-invalid")
    return fd, identity(fd)


def verify_root(root, expected, blocker):
    try:
        current = os.lstat(root)
    except OSError:
        fail(blocker, "root-changed")
    if (
        stat.S_ISLNK(current.st_mode)
        or not stat.S_ISDIR(current.st_mode)
        or (current.st_dev, current.st_ino) != expected
    ):
        fail(blocker, "root-changed")


def open_dir(parent_fd, name, blocker, create=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
        except OSError:
            fail(blocker, "mkdir-failed")
    try:
        fd = os.open(name, os.O_RDONLY | DIRECTORY | NOFOLLOW, dir_fd=parent_fd)
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail(blocker, "symlink")
        if error.errno == errno.ENOENT:
            fail(blocker, "missing")
        fail(blocker, "unreadable")
    if not stat.S_ISDIR(os.fstat(fd).st_mode):
        os.close(fd)
        fail(blocker, "not-directory")
    return fd


def open_parent(root_fd, relative, blocker, create=False):
    path_parts = parts(relative, blocker)
    current = os.dup(root_fd)
    try:
        for segment in path_parts[:-1]:
            next_fd = open_dir(current, segment, blocker, create=create)
            os.close(current)
            current = next_fd
        return current, path_parts[-1]
    except Exception:
        os.close(current)
        raise


def open_relative_dir(root_fd, relative, blocker):
    path_parts = parts(relative, blocker, allow_root=True)
    current = os.dup(root_fd)
    try:
        for segment in path_parts:
            next_fd = open_dir(current, segment, blocker)
            os.close(current)
            current = next_fd
        return current
    except Exception:
        os.close(current)
        raise


def maybe_pause():
    if os.environ.get("SPECNAV_SAFE_FS_TEST_MODE") != "1":
        return
    ready = os.environ.get("SPECNAV_SAFE_FS_TEST_READY")
    proceed = os.environ.get("SPECNAV_SAFE_FS_TEST_CONTINUE")
    if not ready or not proceed:
        return
    with open(ready, "w", encoding="utf-8") as handle:
        handle.write("ready\n")
    deadline = time.monotonic() + 10
    while not os.path.exists(proceed):
        if time.monotonic() >= deadline:
            raise GuardError("verification-operations:safe-fs-test-timeout")
        time.sleep(0.01)


def read_file(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    file_fd = None
    try:
        maybe_pause()
        parent_fd, leaf = open_parent(
            root_fd,
            request["relative"],
            blocker
        )
        try:
            file_fd = os.open(leaf, os.O_RDONLY | NOFOLLOW, dir_fd=parent_fd)
        except FileNotFoundError:
            if request.get("optional") is True:
                verify_root(request["root"], root_identity, blocker)
                return {"exists": False}
            fail(blocker, "missing")
        except OSError as error:
            if error.errno in (errno.ELOOP, errno.ENOTDIR):
                fail(blocker, "symlink")
            fail(blocker, "unreadable")
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode):
            fail(blocker, "not-file")
        chunks = []
        while True:
            chunk = os.read(file_fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(file_fd)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            fail(blocker, "changed-during-read")
        verify_root(request["root"], root_identity, blocker)
        return {
            "exists": True,
            "data_base64": base64.b64encode(b"".join(chunks)).decode("ascii"),
        }
    finally:
        if file_fd is not None:
            os.close(file_fd)
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def read_existing(parent_fd, leaf, blocker):
    try:
        file_fd = os.open(leaf, os.O_RDONLY | NOFOLLOW, dir_fd=parent_fd)
    except FileNotFoundError:
        return None
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail(blocker, "symlink")
        fail(blocker, "unreadable")
    try:
        value = os.fstat(file_fd)
        if not stat.S_ISREG(value.st_mode):
            fail(blocker, "not-file")
        chunks = []
        while True:
            chunk = os.read(file_fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(file_fd)


def replace_bytes(
    parent_fd,
    leaf,
    data,
    blocker,
    exclusive=False,
    expected=UNSET,
):
    previous = read_existing(parent_fd, leaf, blocker)
    if expected is not UNSET and previous != expected:
        fail(blocker, "changed-during-write")
    if exclusive and previous is not None:
        fail(blocker, "exists")
    temporary = f".{leaf}.{os.getpid()}.{secrets.token_hex(6)}.tmp"
    temp_fd = None
    try:
        temp_fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW,
            0o600,
            dir_fd=parent_fd,
        )
        offset = 0
        while offset < len(data):
            offset += os.write(temp_fd, data[offset:])
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = None
        os.replace(
            temporary,
            leaf,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        os.fsync(parent_fd)
        return previous
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        try:
            os.unlink(temporary, dir_fd=parent_fd)
        except FileNotFoundError:
            pass


def restore_bytes(parent_fd, leaf, previous, blocker):
    if previous is None:
        try:
            os.unlink(leaf, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        return
    replace_bytes(parent_fd, leaf, previous, blocker)


def atomic_write(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    previous = None
    leaf = None
    try:
        maybe_pause()
        parent_fd, leaf = open_parent(
            root_fd,
            request["relative"],
            blocker,
            create=True,
        )
        data = base64.b64decode(request["data_base64"], validate=True)
        if request.get("exclusive") is True:
            try:
                file_fd = os.open(
                    leaf,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW,
                    0o600,
                    dir_fd=parent_fd,
                )
            except FileExistsError:
                fail(blocker, "exists")
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    fail(blocker, "symlink")
                fail(blocker, "write-failed")
            try:
                offset = 0
                while offset < len(data):
                    offset += os.write(file_fd, data[offset:])
                os.fsync(file_fd)
            finally:
                os.close(file_fd)
            try:
                verify_root(request["root"], root_identity, blocker)
            except Exception:
                try:
                    os.unlink(leaf, dir_fd=parent_fd)
                except FileNotFoundError:
                    pass
                raise
            os.fsync(parent_fd)
            return {"written": True, "replaced": False}
        expected = UNSET
        if "expected_exists" in request:
            if request["expected_exists"] is True:
                expected = base64.b64decode(
                    request["expected_base64"],
                    validate=True,
                )
            else:
                expected = None
        previous = replace_bytes(
            parent_fd,
            leaf,
            data,
            blocker,
            exclusive=False,
            expected=expected,
        )
        try:
            verify_root(request["root"], root_identity, blocker)
        except Exception:
            restore_bytes(parent_fd, leaf, previous, blocker)
            raise
        return {"written": True, "replaced": previous is not None}
    finally:
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def append_jsonl(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    previous = None
    try:
        maybe_pause()
        parent_fd, leaf = open_parent(
            root_fd,
            request["relative"],
            blocker,
            create=True,
        )
        previous = read_existing(parent_fd, leaf, blocker)
        if previous not in (None, b"") and not previous.endswith(b"\n"):
            fail(blocker, "jsonl-unterminated")
        data = base64.b64decode(request["data_base64"], validate=True)
        if not data.endswith(b"\n"):
            fail(blocker, "jsonl-record-invalid")
        combined = (previous or b"") + data
        replace_bytes(
            parent_fd,
            leaf,
            combined,
            blocker,
            expected=previous,
        )
        try:
            verify_root(request["root"], root_identity, blocker)
        except Exception:
            restore_bytes(parent_fd, leaf, previous, blocker)
            raise
        return {"written": True, "replaced": previous is not None}
    finally:
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def remove_file(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    try:
        parent_fd, leaf = open_parent(root_fd, request["relative"], blocker)
        try:
            value = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            if request.get("optional") is True:
                verify_root(request["root"], root_identity, blocker)
                return {"removed": False}
            fail(blocker, "missing")
        if stat.S_ISLNK(value.st_mode):
            fail(blocker, "symlink")
        if not stat.S_ISREG(value.st_mode):
            fail(blocker, "not-file")
        os.unlink(leaf, dir_fd=parent_fd)
        os.fsync(parent_fd)
        verify_root(request["root"], root_identity, blocker)
        return {"removed": True}
    finally:
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def create_lock(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    lock_fd = None
    try:
        parent_fd, leaf = open_parent(
            root_fd,
            request["relative"],
            blocker,
            create=True,
        )
        try:
            os.mkdir(leaf, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            fail(blocker, "exists")
        except OSError:
            fail(blocker, "mkdir-failed")
        lock_fd = open_dir(parent_fd, leaf, blocker)
        owner_fd = None
        try:
            owner_fd = os.open(
                "owner",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW,
                0o600,
                dir_fd=lock_fd,
            )
            data = request["token"].encode("utf-8") + b"\n"
            offset = 0
            while offset < len(data):
                offset += os.write(owner_fd, data[offset:])
            os.fsync(owner_fd)
        finally:
            if owner_fd is not None:
                os.close(owner_fd)
        os.fsync(lock_fd)
        os.fsync(parent_fd)
        try:
            verify_root(request["root"], root_identity, blocker)
        except Exception:
            try:
                os.unlink("owner", dir_fd=lock_fd)
                os.rmdir(leaf, dir_fd=parent_fd)
            except OSError:
                pass
            raise
        return {"acquired": True}
    except Exception:
        if lock_fd is not None:
            try:
                os.unlink("owner", dir_fd=lock_fd)
            except OSError:
                pass
            try:
                os.rmdir(leaf, dir_fd=parent_fd)
            except OSError:
                pass
        raise
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def release_lock(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    lock_fd = None
    owner_fd = None
    try:
        parent_fd, leaf = open_parent(root_fd, request["relative"], blocker)
        lock_fd = open_dir(parent_fd, leaf, blocker)
        try:
            owner_fd = os.open(
                "owner",
                os.O_RDONLY | NOFOLLOW,
                dir_fd=lock_fd,
            )
        except OSError as error:
            if error.errno in (errno.ELOOP, errno.ENOTDIR):
                fail(blocker, "symlink")
            fail(blocker, "owner-missing")
        owner = os.read(owner_fd, 4096).decode("utf-8").strip()
        if owner != request["token"]:
            fail(blocker, "owner-mismatch")
        owner_stat = os.fstat(owner_fd)
        current_owner = os.stat(
            "owner",
            dir_fd=lock_fd,
            follow_symlinks=False,
        )
        if (owner_stat.st_dev, owner_stat.st_ino) != (
            current_owner.st_dev,
            current_owner.st_ino,
        ):
            fail(blocker, "owner-changed")
        os.unlink("owner", dir_fd=lock_fd)
        os.fsync(lock_fd)
        os.close(owner_fd)
        owner_fd = None
        os.close(lock_fd)
        lock_fd = None
        os.rmdir(leaf, dir_fd=parent_fd)
        os.fsync(parent_fd)
        verify_root(request["root"], root_identity, blocker)
        return {"released": True}
    finally:
        if owner_fd is not None:
            os.close(owner_fd)
        if lock_fd is not None:
            os.close(lock_fd)
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def copy_regular(
    source_fd,
    source_name,
    target_fd,
    target_name,
    blocker,
    expected,
):
    try:
        read_fd = os.open(
            source_name,
            os.O_RDONLY | NOFOLLOW,
            dir_fd=source_fd,
        )
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail(blocker, "symlink")
        fail(blocker, "unreadable")
    write_fd = None
    try:
        before = os.fstat(read_fd)
        if not stat.S_ISREG(before.st_mode):
            fail(blocker, "unsupported-entry")
        if (before.st_dev, before.st_ino) != (expected.st_dev, expected.st_ino):
            fail(blocker, "changed-during-copy")
        write_fd = os.open(
            target_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW,
            stat.S_IMODE(before.st_mode),
            dir_fd=target_fd,
        )
        while True:
            chunk = os.read(read_fd, 1024 * 1024)
            if not chunk:
                break
            offset = 0
            while offset < len(chunk):
                offset += os.write(write_fd, chunk[offset:])
        os.fsync(write_fd)
        after = os.fstat(read_fd)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            fail(blocker, "changed-during-copy")
    finally:
        if write_fd is not None:
            os.close(write_fd)
        os.close(read_fd)


def copy_directory(source_fd, target_fd, blocker):
    before = sorted(os.listdir(source_fd))
    for name in before:
        value = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        if stat.S_ISLNK(value.st_mode):
            fail(blocker, "symlink")
        if stat.S_ISDIR(value.st_mode):
            source_child = open_dir(source_fd, name, blocker)
            try:
                opened = os.fstat(source_child)
                if (opened.st_dev, opened.st_ino) != (value.st_dev, value.st_ino):
                    fail(blocker, "changed-during-copy")
                os.mkdir(name, stat.S_IMODE(value.st_mode), dir_fd=target_fd)
                target_child = open_dir(target_fd, name, blocker)
                try:
                    copy_directory(source_child, target_child, blocker)
                finally:
                    os.close(target_child)
            finally:
                os.close(source_child)
            continue
        if stat.S_ISREG(value.st_mode):
            copy_regular(
                source_fd,
                name,
                target_fd,
                name,
                blocker,
                value,
            )
            continue
        fail(blocker, "unsupported-entry")
    if before != sorted(os.listdir(source_fd)):
        fail(blocker, "changed-during-copy")
    os.fsync(target_fd)


def remove_tree_at(parent_fd, leaf, blocker, allow_leaf_symlink=False):
    try:
        value = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(value.st_mode):
        if not allow_leaf_symlink:
            fail(blocker, "symlink")
        os.unlink(leaf, dir_fd=parent_fd)
        return True
    if stat.S_ISREG(value.st_mode):
        os.unlink(leaf, dir_fd=parent_fd)
        return True
    if not stat.S_ISDIR(value.st_mode):
        fail(blocker, "unsupported-entry")
    child_fd = open_dir(parent_fd, leaf, blocker)
    try:
        for name in os.listdir(child_fd):
            remove_tree_at(child_fd, name, blocker, allow_leaf_symlink=True)
    finally:
        os.close(child_fd)
    os.rmdir(leaf, dir_fd=parent_fd)
    return True


def remove_tree(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    parent_fd = None
    try:
        parent_fd, leaf = open_parent(root_fd, request["relative"], blocker)
        removed = remove_tree_at(
            parent_fd,
            leaf,
            blocker,
            allow_leaf_symlink=request.get("allow_leaf_symlink") is True,
        )
        os.fsync(parent_fd)
        verify_root(request["root"], root_identity, blocker)
        return {"removed": removed}
    finally:
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


def copy_tree(request):
    blocker = request["blocker_id"]
    source_fd, source_identity = open_root(request["source_root"], blocker)
    target_fd, target_identity = open_root(request["target_root"], blocker)
    source_dir = None
    target_parent = None
    target_child = None
    try:
        maybe_pause()
        source_dir = open_relative_dir(
            source_fd,
            request.get("source_relative", "."),
            blocker,
        )
        target_parent, target_leaf = open_parent(
            target_fd,
            request["target_relative"],
            blocker,
            create=True,
        )
        try:
            os.mkdir(target_leaf, 0o700, dir_fd=target_parent)
        except FileExistsError:
            fail(blocker, "target-exists")
        target_child = open_dir(target_parent, target_leaf, blocker)
        copy_directory(source_dir, target_child, blocker)
        verify_root(request["source_root"], source_identity, blocker)
        verify_root(request["target_root"], target_identity, blocker)
        return {"copied": True}
    except Exception:
        if target_parent is not None:
            try:
                remove_tree_at(
                    target_parent,
                    request["target_relative"].split("/")[-1],
                    blocker,
                    allow_leaf_symlink=True,
                )
            except Exception:
                pass
        raise
    finally:
        if target_child is not None:
            os.close(target_child)
        if target_parent is not None:
            os.close(target_parent)
        if source_dir is not None:
            os.close(source_dir)
        os.close(target_fd)
        os.close(source_fd)


def list_directory(request):
    blocker = request["blocker_id"]
    root_fd, root_identity = open_root(request["root"], blocker)
    directory_fd = None
    try:
        directory_fd = open_relative_dir(
            root_fd,
            request.get("relative", "."),
            blocker,
        )
        entries = []
        for name in sorted(os.listdir(directory_fd)):
            value = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISLNK(value.st_mode):
                kind = "symlink"
            elif stat.S_ISDIR(value.st_mode):
                kind = "directory"
            elif stat.S_ISREG(value.st_mode):
                kind = "file"
            else:
                kind = "unsupported"
            entries.append({"name": name, "kind": kind})
        verify_root(request["root"], root_identity, blocker)
        return {"entries": entries}
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
        os.close(root_fd)


def main():
    request = json.load(sys.stdin)
    action = request.get("action")
    handlers = {
        "read_file": read_file,
        "atomic_write": atomic_write,
        "append_jsonl": append_jsonl,
        "remove_file": remove_file,
        "create_lock": create_lock,
        "release_lock": release_lock,
        "copy_tree": copy_tree,
        "remove_tree": remove_tree,
        "list_directory": list_directory,
    }
    if action not in handlers:
        raise GuardError("verification-operations:safe-fs-action-invalid")
    result = handlers[action](request)
    print(json.dumps({"ok": True, **result}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except GuardError as error:
        print(json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")))
        sys.exit(2)
    except Exception:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "verification-operations:safe-fs-failed",
                },
                separators=(",", ":"),
            )
        )
        sys.exit(2)

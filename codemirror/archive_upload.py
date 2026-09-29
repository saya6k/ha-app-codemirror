"""Validate a single-folder ZIP and publish it without overwriting existing data."""
from contextlib import contextmanager
import os
import secrets
import stat
import zipfile
import zlib

from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from filesystem import directory, parts, DIR_FLAGS, atomic_write
from file_actions import rename_exclusive, remove


def extract_folder(root, folder, stream, limit):
    depth = len(parts(folder, allow_empty=True))
    try:
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > 10000:
                raise BadRequest('Archive must contain 1–10000 entries')
            known = {}
            directories = set()
            total = 0
            roots = set()
            for entry in entries:
                name = entry.filename.rstrip('/') if entry.is_dir() else entry.filename
                segments = parts(name)
                if (entry.orig_filename != entry.filename or depth + len(segments) > 32 or any(len(s.encode('utf-8')) > 255 or ':' in s or
                        s.endswith('.backup') for s in segments)):
                    raise BadRequest('Invalid or reserved archive path')
                if name in known:
                    raise BadRequest('Duplicate archive paths are not allowed')
                mode = entry.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind and stat.S_ISDIR(mode) != entry.is_dir()):
                    raise BadRequest('Archive links and special files are not supported')
                if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise BadRequest('Use an unencrypted ZIP with standard compression')
                if len(segments) == 1 and not entry.is_dir():
                    raise BadRequest('ZIP must contain one top-level directory')
                roots.add(segments[0])
                known[name] = entry
                for length in range(1, len(segments) + (1 if entry.is_dir() else 0)):
                    directories.add('/'.join(segments[:length]))
                total += entry.file_size
                if total > limit:
                    raise RequestEntityTooLarge('Uncompressed folder exceeds the upload limit')
            if len(roots) != 1 or len(set(known) | directories) > 10000:
                raise BadRequest('ZIP must contain one folder with at most 10000 entries')
            if any(path in known and not known[path].is_dir() for path in directories):
                raise BadRequest('Archive file and directory paths conflict')
            top = next(iter(roots))
            with directory(root, folder) as destination:
                staging = '.codemirror-' + secrets.token_hex(16)
                os.mkdir(staging, 0o700, dir_fd=destination)
                stage = os.open(staging, DIR_FLAGS, dir_fd=destination)
                try:
                    # All archive paths were validated. Walk stage-relative descriptors.
                    for path in sorted(directories, key=lambda p: (p.count('/'), p)):
                        with relative_directory(stage, path.split('/')[:-1]) as parent_fd:
                            os.mkdir(path.split('/')[-1], 0o755, dir_fd=parent_fd)
                    remaining = limit
                    for path, entry in known.items():
                        if entry.is_dir():
                            continue
                        with relative_directory(stage, path.split('/')[:-1]) as parent_fd, archive.open(entry) as content:
                            size = atomic_write(parent_fd, path.split('/')[-1], content, remaining)
                            remaining -= size
                    rename_exclusive(stage, top, destination, top)
                finally:
                    os.close(stage)
                    remove(destination, staging)
            return {'path': f'{folder}/{top}' if folder else top, 'files': sum(not e.is_dir() for e in entries), 'size': total}
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error) as error:
        raise BadRequest('Invalid or unsupported ZIP archive') from error


@contextmanager
def relative_directory(start, segments):
    fd = os.dup(start)
    try:
        for segment in segments:
            child = os.open(segment, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)

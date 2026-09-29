"""Rooted file operations. Never follow links from user-controlled directories."""

from contextlib import contextmanager
from datetime import datetime, timezone
import errno
import os
from pathlib import Path
import secrets
import stat

from werkzeug.exceptions import BadRequest, Conflict, Forbidden, RequestEntityTooLarge

TEXT_EXTENSIONS = {'.yaml', '.yml', '.json', '.py', '.sh', '.md', '.markdown',
                   '.txt', '.conf', '.ini', '.toml', '.xml', '.css', '.js', '.ts',
                   '.html', '.pem', '.crt', '.key', '.log'}
MAX_TEXT_BYTES = 4 * 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def parts(path, allow_empty=False):
    if not isinstance(path, str):
        raise BadRequest('Path must be a string')
    if path == '' and allow_empty:
        return []
    segments = path.split('/')
    if ('\\' in path or any(not s or s in ('.', '..') or
            s.startswith('.codemirror-') or any(ord(c) < 32 for c in s)
            for s in segments)):
        raise Forbidden('Access denied')
    return segments


@contextmanager
def directory(root, path=''):
    """Walk using directory descriptors, so symlink swaps cannot escape a root."""
    segments = parts(path, allow_empty=True)
    fd = os.open(root, DIR_FLAGS)
    try:
        for segment in segments:
            next_fd = os.open(segment, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


@contextmanager
def parent(root, path):
    segments = parts(path)
    with directory(root, '/'.join(segments[:-1])) as fd:
        yield fd, segments[-1]


def regular_file(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Forbidden('Only regular, unlinked files are supported')
    return info


def check_target(fd, name):
    try:
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Forbidden('Access denied')
    return info


def read_at(fd, name):
    opened = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(opened, 'rb') as stream:
        info = regular_file(stream.fileno())
        if info.st_size > MAX_TEXT_BYTES:
            raise RequestEntityTooLarge('Editor supports files up to 4 MiB')
        data = stream.read(MAX_TEXT_BYTES + 1)
        if len(data) > MAX_TEXT_BYTES:
            raise RequestEntityTooLarge('Editor supports files up to 4 MiB')
        return data, info


def read_text(root, path):
    if Path(path).suffix.lower() not in TEXT_EXTENSIONS:
        raise BadRequest('This file type is available for upload only')
    with parent(root, path) as (fd, name):
        data, info = read_at(fd, name)
    content = data.decode('utf-8')
    if '\x00' in content:
        raise BadRequest('File is not a text file')
    return {'filename': path, 'content': content, 'size': info.st_size,
            'modified': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()}


def atomic_write(fd, name, stream, limit, replace=False, mode=0o644, owner=None):
    temp_name = '.codemirror-' + secrets.token_hex(16)
    temp_fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=fd)
    try:
        with os.fdopen(temp_fd, 'wb') as output:
            size = 0
            while chunk := stream.read(64 * 1024):
                size += len(chunk)
                if size > limit:
                    raise RequestEntityTooLarge('File exceeds the configured size limit')
                output.write(chunk)
            output.flush()
            if owner is not None:
                os.fchown(output.fileno(), *owner)
            os.fchmod(output.fileno(), stat.S_IMODE(mode))
            os.fsync(output.fileno())
        if replace:
            # rename replaces a directory entry; it never follows a destination link.
            os.replace(temp_name, name, src_dir_fd=fd, dst_dir_fd=fd)
        else:
            # Atomic no-clobber publish, even when another upload uses the same name.
            try:
                os.link(temp_name, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            except FileExistsError:
                raise Conflict('A file with this name already exists') from None
        return size
    finally:
        try:
            os.unlink(temp_name, dir_fd=fd)
        except FileNotFoundError:
            pass


def save_text(root, path, content):
    from io import BytesIO
    if not isinstance(content, str):
        raise BadRequest('Content must be a string')
    if Path(path).suffix.lower() not in TEXT_EXTENSIONS:
        raise Forbidden('Unsupported text extension')
    data = content.encode('utf-8')
    if len(data) > MAX_TEXT_BYTES:
        raise RequestEntityTooLarge('Editor supports files up to 4 MiB')
    with parent(root, path) as (fd, name):
        info = check_target(fd, name)
        mode = info.st_mode if info else 0o644
        owner = (info.st_uid, info.st_gid) if info else None
        if info:
            old, _ = read_at(fd, name)
            backup = name + '.backup'
            check_target(fd, backup)
            atomic_write(fd, backup, BytesIO(old), MAX_TEXT_BYTES, replace=True, mode=mode, owner=owner)
        return atomic_write(fd, name, BytesIO(data), MAX_TEXT_BYTES, replace=True, mode=mode, owner=owner)


def upload(root, folder, storage, limit):
    name = storage.filename
    if (not name or '/' in name or '\\' in name or name in ('.', '..') or
            name.startswith('.codemirror-') or name.endswith('.backup') or
            any(ord(c) < 32 for c in name)):
        raise BadRequest('Upload requires a plain filename (no paths or backup files)')
    with directory(root, folder) as fd:
        if check_target(fd, name) is not None:
            raise Conflict('A file with this name already exists')
        return atomic_write(fd, name, storage.stream, limit)


def create_entry(root, folder, name, kind):
    """Create a single entry in an existing parent, never replacing an entry."""
    from io import BytesIO
    if (kind not in ('file', 'directory') or not isinstance(name, str) or
            not name.strip() or name in ('.', '..') or '/' in name or '\\' in name or
            name.startswith('.codemirror-') or name.endswith('.backup') or
            any(ord(c) < 32 for c in name) or len(name.encode('utf-8')) > 255):
        raise BadRequest('Use a single filename or directory name, without paths')
    if kind == 'file' and Path(name).suffix.lower() not in TEXT_EXTENSIONS:
        raise BadRequest('Use a supported text extension, such as .yaml, .json or .md')
    with directory(root, folder) as fd:
        if kind == 'directory':
            try:
                os.mkdir(name, 0o755, dir_fd=fd)
            except FileExistsError:
                raise Conflict('An entry with this name already exists') from None
        else:
            content = b'{}\n' if Path(name).suffix.lower() == '.json' else b''
            atomic_write(fd, name, BytesIO(content), MAX_TEXT_BYTES)
    return {'path': f'{folder}/{name}' if folder else name, 'type': kind}


def file_tree(root):
    """Bound recursive discovery; do not follow symlinks or enter private internals."""
    budget = 10000

    def walk(fd, prefix='', depth=0):
        nonlocal budget
        if depth > 32:
            raise BadRequest('Directory tree exceeds 32 levels')
        nodes = []
        with os.scandir(fd) as entries:
            for item in entries:
                budget -= 1
                if budget < 0:
                    raise BadRequest('Directory tree exceeds 10000 entries')
                if (item.name.startswith('.codemirror-') or item.name.endswith('.backup') or
                        item.name in ('.git', '.storage', '__pycache__', 'node_modules')):
                    continue
                path = f'{prefix}/{item.name}' if prefix else item.name
                try:
                    info = item.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(item.name, DIR_FLAGS, dir_fd=fd)
                        try:
                            children = walk(child, path, depth + 1)
                        finally:
                            os.close(child)
                        nodes.append({'name': item.name, 'path': path,
                                      'type': 'directory', 'children': children})
                    elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                        nodes.append({'name': item.name, 'path': path, 'type': 'file',
                                      'size': info.st_size,
                                      'editable': Path(item.name).suffix.lower() in TEXT_EXTENSIONS})
                except OSError as error:
                    if error.errno not in (errno.ENOENT, errno.EACCES, errno.ELOOP, errno.ENOTDIR):
                        raise
        return sorted(nodes, key=lambda node: (node['type'] != 'directory', node['name'].casefold()))

    with directory(root) as fd:
        return walk(fd)

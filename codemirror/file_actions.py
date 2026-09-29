"""Descriptor-relative explorer actions; no links, root mutations or overwrites."""
import ctypes
import errno
import os
import secrets
import shutil
import stat
import sys

from werkzeug.exceptions import BadRequest, Conflict, Forbidden, RequestEntityTooLarge
from filesystem import directory, parent, parts, DIR_FLAGS, regular_file, atomic_write


def rename_exclusive(src_fd, src, dst_fd, dst):
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        fn, flag = libc.renameatx_np, 4  # RENAME_EXCL
    else:
        fn, flag = libc.renameat2, 1  # RENAME_NOREPLACE (Linux runtime)
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(src_fd, os.fsencode(src), dst_fd, os.fsencode(dst), flag) != 0:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise Conflict('An entry with this name already exists')
        raise OSError(code, os.strerror(code))


def scan(fd, name, budget, depth=0):
    budget[0] -= 1
    if budget[0] < 0 or depth > 32:
        raise BadRequest('Operation exceeds 10000 entries or 32 levels')
    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if stat.S_ISDIR(info.st_mode):
        child = os.open(name, DIR_FLAGS, dir_fd=fd)
        try:
            for item in os.listdir(child):
                scan(child, item, budget, depth + 1)
        finally:
            os.close(child)
    elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Forbidden('Links and special files are not supported')
    else:
        budget[1] -= info.st_size
        if budget[1] < 0:
            raise RequestEntityTooLarge('Operation exceeds 512 MiB')
    return info


def remove(fd, name):
    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if stat.S_ISDIR(info.st_mode):
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError('Safe directory deletion is unavailable')
        shutil.rmtree(name, dir_fd=fd)
    else:
        os.unlink(name, dir_fd=fd)


def copy_entry(src_fd, name, dst_fd, target, budget, depth=0):
    budget[0] -= 1
    if budget[0] < 0 or depth > 32:
        raise BadRequest('Operation exceeds 10000 entries or 32 levels')
    info = os.stat(name, dir_fd=src_fd, follow_symlinks=False)
    if stat.S_ISDIR(info.st_mode):
        source = os.open(name, DIR_FLAGS, dir_fd=src_fd)
        try:
            os.mkdir(target, 0o700, dir_fd=dst_fd)
            destination = os.open(target, DIR_FLAGS, dir_fd=dst_fd)
            try:
                for item in os.listdir(source):
                    copy_entry(source, item, destination, item, budget, depth + 1)
                os.fchmod(destination, stat.S_IMODE(info.st_mode) & 0o777)
            finally:
                os.close(destination)
        finally:
            os.close(source)
    else:
        opened = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=src_fd)
        with os.fdopen(opened, 'rb') as stream:
            info = regular_file(stream.fileno())
            size = atomic_write(dst_fd, target, stream, budget[1], mode=info.st_mode & 0o777)
            budget[1] -= size


def operate(root, path, action, destination_root=None, destination=None):
    parts(path)  # Empty paths (mounted roots) cannot be mutated.
    if action not in ('delete', 'copy', 'move'):
        raise BadRequest('Unknown file action')
    if action != 'delete':
        parts(destination)
        if root == destination_root and (destination == path or destination.startswith(path + '/')):
            raise BadRequest('Cannot paste an entry into itself')
    with parent(root, path) as (src_fd, name):
        scan(src_fd, name, [10000, 512 * 1024 * 1024])
        if action == 'delete':
            remove(src_fd, name)
            return
        with parent(destination_root, destination) as (dst_fd, target):
            if action == 'move':
                try:
                    rename_exclusive(src_fd, name, dst_fd, target)
                    return
                except OSError as error:
                    if error.errno != errno.EXDEV:
                        raise
            # Stage a full copy before publishing; source is untouched on copy failure.
            temporary = '.codemirror-' + secrets.token_hex(16)
            try:
                copy_entry(src_fd, name, dst_fd, temporary, [10000, 512 * 1024 * 1024])
                rename_exclusive(dst_fd, temporary, dst_fd, target)
            finally:
                try:
                    remove(dst_fd, temporary)
                except FileNotFoundError:
                    pass
            if action == 'move':
                try:
                    remove(src_fd, name)
                except OSError as error:
                    raise Conflict('Destination copied, but source removal failed. Both entries may remain; refresh before retrying.') from error

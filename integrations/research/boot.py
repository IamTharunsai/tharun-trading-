"""Initialize only the mounted state directory, then permanently drop privileges."""
import ctypes
import os
import runpy
import stat
from pathlib import Path

state = Path('/data')
info = state.lstat()
if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
    raise SystemExit('Invalid research state directory')
if os.getuid() == 0:
    os.chown(state, 10001, 10001)
    os.chmod(state, 0o700)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
if os.getuid() != 10001:
    raise SystemExit('Research must run as its isolated service identity')
# Prevent same-UID lower-trust workers from reading gateway credentials via proc/ptrace.
if ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) != 0:
    raise SystemExit('Research process isolation could not be established')
runpy.run_path('/bridge/gateway.py', run_name='__main__')

"""Build-only public corpus preparation; never scans the operator's workspace."""
import json
import shutil
from pathlib import Path

source, target = Path('/public-source'), Path('/corpus')
allowed = {'.ts', '.tsx', '.js', '.jsx', '.py', '.prisma', '.sql', '.css'}
excluded = {'.git', 'node_modules', 'dist', 'build', '.venv', 'vendor'}
target.mkdir()
files = []
for path in sorted(source.rglob('*')):
    relative = path.relative_to(source)
    if path.is_symlink() or any(part in excluded or part.startswith('.env') for part in relative.parts):
        continue
    if path.is_file() and path.suffix in allowed and path.stat().st_size <= 1048576:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        files.append(str(relative))
if not files:
    raise SystemExit('Empty public corpus')
Path('/corpus-manifest.json').write_text(json.dumps(files))

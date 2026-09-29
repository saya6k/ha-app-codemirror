"""Create a complete local-app archive without dependencies or test artifacts."""
from pathlib import Path
import json
import tarfile


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'codemirror'


def package():
    files = [APP / name for name in (
        'Dockerfile', '.dockerignore', 'config.yaml', 'requirements.txt',
        'app.py', 'filesystem.py', 'file_actions.py', 'run.sh', 'LICENSE.md', 'README.md',
        'DOCS.md', 'CHANGELOG.md',
        'frontend/package.json', 'frontend/package-lock.json',
        'frontend/index.html', 'frontend/styles.css',
        'frontend/tsconfig.json', 'frontend/vite.config.ts',
    )]
    for directory in ('frontend/src', 'translations'):
        files.extend(sorted(path for path in (APP / directory).rglob('*') if path.is_file()))
    for required in files + [APP / 'frontend/src/main.ts']:
        if not required.is_file() or required.is_symlink():
            raise RuntimeError(f'Missing or linked package input: {required}')
    version = json.loads((APP / 'frontend/package.json').read_text())['version']
    output = ROOT / 'dist' / f'codemirror-{version}.tar.gz'
    output.parent.mkdir(exist_ok=True)
    with tarfile.open(output, 'w:gz', format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            archive.add(path, arcname=str(Path('codemirror') / path.relative_to(APP)), recursive=False)
    print(f'{output}: {len(files)} files')


if __name__ == '__main__':
    package()

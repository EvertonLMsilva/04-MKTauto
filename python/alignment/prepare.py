"""Explicit, one-time download of approved model data only. Run inside the isolated venv."""
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import sys
import urllib.request
from align import MODEL, REVISION

FILES = ['config.json', 'preprocessor_config.json', 'vocab.json',
         'special_tokens_map.json', 'pytorch_model.bin', 'README.md']


def prepare(root):
    if sys.version_info[:2] != (3, 12) or sys.prefix == sys.base_prefix:
        raise RuntimeError('Python 3.12 isolated venv required')
    root.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in FILES:
        path = root / name
        url = f'https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}'
        temporary = path.with_suffix(path.suffix + '.download')
        digest = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
        temporary.replace(path)
        hashes[name] = digest.hexdigest()
    packages = []
    for dist in metadata.distributions():
        files = {}
        for file in dist.files or []:
            if str(file).endswith(('METADATA', 'RECORD')) or 'license' in str(file).lower():
                path = Path(dist.locate_file(file))
                if path.is_file():
                    files[str(file)] = hashlib.sha256(path.read_bytes()).hexdigest()
        packages.append(dict(name=dist.metadata['Name'], version=dist.version,
                             license=dist.metadata.get('License-Expression') or dist.metadata.get('License') or 'UNAVAILABLE',
                             metadataSha256=files))
    environment = json.dumps(dict(python=sys.version, packages=packages), indent=2).encode()
    (root / 'environment.json').write_bytes(environment)
    manifest = dict(model=MODEL, revision=REVISION, license='Apache-2.0', files=hashes,
                    environmentSha256=hashlib.sha256(environment).hexdigest())
    raw = json.dumps(manifest, sort_keys=True, indent=2).encode()
    (root / 'manifest.json').write_bytes(raw)
    print(json.dumps(dict(modelRoot=str(root.resolve()), manifestSha256=hashlib.sha256(raw).hexdigest())))


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))

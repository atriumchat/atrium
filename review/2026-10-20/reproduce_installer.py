"""Run extracted installer functions with a failing install command; all writes stay in a temporary directory."""
from pathlib import Path
import io
import re
import subprocess
import tarfile
import tempfile

installer = (Path(__file__).resolve().parents[2] / 'deploy' / 'install.sh').read_text()
functions = []
for name in ['step_files', 'run']:
    match = re.search(r'^' + name + r'\(\) \{\n.*?^\}', installer, re.M | re.S)
    assert match, name
    functions.append(match.group(0))
root = Path(tempfile.mkdtemp(prefix='gomex-installer-review-'))
archive = root / 'release.tgz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in ['docker-compose.yml', 'Caddyfile', 'backup.sh', 'livekit.yaml.tmpl']:
        data = b'review fixture\n'
        info = tarfile.TarInfo('gomex-review/deploy/' + name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
script = '''#!/usr/bin/env bash
set -Eeuo pipefail
TTY=0
GOMEX_PROGRESS=0
SECONDS=0
C_DIM='' C_RESET=''
RELEASE_VERSION=review
progress(){ :; }
log(){ :; }
line(){ :; }
ok(){ printf 'STEP_REPORTED_SUCCESS\\n'; }
bad(){ printf 'STEP_REPORTED_FAILURE\\n'; }
die(){ exit 1; }
sha256_ok(){ return 0; }
install(){ printf 'SIMULATED_INSTALL_FAILURE\\n' >&2; return 1; }
'''
script += f'GOMEX_TMP={root}\nGOMEX_DIR={root / "destination"}\nTARBALL_SRC={archive}\nTARBALL_SHA256=fixture\nLOG={root / "test.log"}\n'
script += '\n'.join(functions) + '''
run 'review' step_files
printf 'DESTINATION_FILES='
find "$GOMEX_DIR/deploy" -type f | wc -l
'''
(root / 'run.bash').write_text(script)
result = subprocess.run(['bash', str(root / 'run.bash')],capture_output=True,text=True)
print(result.stdout, result.stderr, 'exit:', result.returncode)
assert result.returncode == 0 and 'STEP_REPORTED_SUCCESS' in result.stdout
assert not list((root / 'destination' / 'deploy').iterdir())

#!/usr/bin/env bash
# Source-module browser checks. Room, IPC and HTTP responses are controlled by the harness.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
for file in web/regression-harness.html web/src/voice/voice.regression.ts web/src/socket.regression.ts; do
  if [[ -e "$file" ]]; then echo "Refusing to overwrite $file" >&2; exit 1; fi
done
cleanup() { rm -f web/regression-harness.html web/src/voice/voice.regression.ts web/src/socket.regression.ts; }
trap cleanup EXIT
cp web/tests/regressions.html web/regression-harness.html
python3 - <<'PY'
from pathlib import Path
p=Path('web/src/voice/voice.ts')
p.with_name('voice.regression.ts').write_text(p.read_text()+'\nexport function __setReporter(value: QualityReporter) { reporter = value; }\n')
p=Path('web/src/socket.ts')
p.with_name('socket.regression.ts').write_text(p.read_text()+'\nexport const __catchUp = catchUp;\n')
PY
echo 'Open http://127.0.0.1:5190/regression-harness.html and click Run checks.'
(cd web && npm run dev -- --host 127.0.0.1 --strictPort)

#!/usr/bin/env bash
# Reproductions use a disposable SDK/IPC/network model and the actual client source. No real microphone is opened.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
for file in web/review-harness.html web/src/voice/voice.review.ts web/src/socket.review.ts; do
  if [[ -e "$file" ]]; then echo "Refusing to overwrite $file" >&2; exit 1; fi
done
cleanup() { rm -f web/review-harness.html web/src/voice/voice.review.ts web/src/socket.review.ts; }
trap cleanup EXIT
cp review/2026-10-20/browser-harness.html web/review-harness.html
python3 - <<'PY'
from pathlib import Path
p=Path('web/src/voice/voice.ts')
p.with_name('voice.review.ts').write_text(p.read_text()+'\nexport function __reviewSetReporter(value: QualityReporter) { reporter = value; }\n')
p=Path('web/src/socket.ts')
p.with_name('socket.review.ts').write_text(p.read_text()+'\nexport const __reviewCatchUp = catchUp;\n')
PY
echo 'Open http://127.0.0.1:5190/review-harness.html and click Run reproductions.'
(cd web && npm run dev -- --host 127.0.0.1)

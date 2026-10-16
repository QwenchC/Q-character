"""Opt-in local VLM evaluation; uses installed weights and generated test artwork only."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--adapter', default='comfyui/QCharacterVision/vision.py')
parser.add_argument('--output', required=True)
parser.add_argument('--cases', nargs='*')
parser.add_argument('--model', default='qwen3.6:35b-a3b')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
if any(out.iterdir()):
    raise SystemExit('Use a new output directory to preserve earlier evidence.')
spec = importlib.util.spec_from_file_location('vision_evaluation', args.adapter)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
fixtures = Path('.runtime/vision-accuracy/fixtures')
cases = json.loads((fixtures / 'cases.json').read_text(encoding='utf-8'))
records = []
for case in cases:
    if args.cases and case['id'] not in args.cases:
        continue
    images = {p.stem: Image.open(p) for p in (fixtures / case['id']).glob('*.png')}
    result = adapter.analyze(images, case['description'], args.model)
    (out / (case['id'] + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    record = {**case, 'elapsedMs': result['elapsedMs'], 'findings': len(result['findings']),
              'checks': [c['verdict'] for c in result.get('analysis', {}).get('checks', [])],
              'inputs': {r: hashlib.sha256((fixtures / case['id'] / (r+'.png')).read_bytes()).hexdigest() for r in images}}
    records.append(record)
    print(json.dumps(record, ensure_ascii=True), flush=True)
(out / 'summary.json').write_text(json.dumps({'model': args.model, 'adapterSha256': hashlib.sha256(Path(args.adapter).read_bytes()).hexdigest(), 'cases': records}, ensure_ascii=False, indent=2), encoding='utf-8')

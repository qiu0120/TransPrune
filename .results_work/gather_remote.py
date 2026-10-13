import csv
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

work = Path('/root/autodl-tmp/transprune-work')
data = work / 'data'
specs = {
    'mme': ('MME/llava_mme.jsonl', 'MME/answers/{run}.jsonl'),
    'textvqa': ('textvqa/llava_textvqa_val_v051_ocr.jsonl', 'textvqa/answers/{run}.jsonl'),
    'scienceqa': ('scienceqa/llava_test_CQM-A.json', 'scienceqa/answers/{run}.jsonl'),
    'pope': ('pope/llava_pope_test.jsonl', 'pope/answers/{run}.jsonl'),
    'gqa': ('gqa/llava_gqa_testdev_balanced.jsonl', 'gqa/answers/{run}.jsonl'),
    'seed': ('seed_bench/llava-seed-bench-image.jsonl', 'seed_bench/answers/{run}.jsonl'),
    'vqav2': ('vqav2/llava_vqav2_mscoco_test-dev2015.jsonl', 'vqav2/answers/llava_vqav2_mscoco_test-dev2015/{run}/merge.jsonl'),
    'mmbench': ('mmbench/mmbench_dev_20230712.tsv', 'mmbench/answers/{run}.jsonl'),
}

def expected_ids(path):
    if path.suffix == '.tsv':
        csv.field_size_limit(50_000_000)
        with path.open() as f:
            return Counter(str(row['index']) for row in csv.DictReader(f, delimiter='\t'))
    with path.open() as f:
        rows = json.load(f) if path.suffix == '.json' else (json.loads(line) for line in f if line.strip())
        return Counter(str(row.get('question_id', row.get('id'))) for row in rows)

result = {'runs': [], 'processes': [], 'server_script': (work / 'run_table1.sh').read_text()}
for bench, (qrel, arel) in specs.items():
    expected = expected_ids(data / qrel)
    for config in ('baseline', 'high', 'low'):
        run = 'table1_' + config
        answer_path = data / arel.format(run=run)
        actual = Counter()
        bad = empty = 0
        if answer_path.exists():
            with answer_path.open() as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                        actual[str(row['question_id'])] += 1
                        empty += not str(row.get('text', '')).strip()
                    except (ValueError, KeyError):
                        bad += 1
        logroot = work / 'results' / run / 'logs'
        score = logroot / (bench + '.score.log')
        infer = logroot / (bench + '.infer.log')
        tail = ''
        if infer.exists():
            with infer.open('rb') as f:
                f.seek(max(0, infer.stat().st_size - 20000))
                tail = f.read().decode('utf-8', errors='replace')
        progress = re.findall(r'(\d+)/(\d+)\s*\[', tail)
        entry = {
            'benchmark': bench, 'config': config,
            'question_path': str(data / qrel), 'answer_path': str(answer_path),
            'expected_count': sum(expected.values()), 'answer_count': sum(actual.values()),
            'missing_ids': sum((expected - actual).values()),
            'extra_ids': sum((actual - expected).values()),
            'bad_lines': bad, 'empty_answers': empty,
            'complete': actual == expected and not bad,
            'score_path': str(score), 'score_text': score.read_text() if score.exists() else '',
            'infer_path': str(infer), 'progress': progress[-1] if progress else None,
            'infer_errors': [line[:300] for line in tail.replace('\r', '\n').splitlines() if any(s in line for s in ('Traceback', 'Error:', 'Killed'))],
        }
        if bench == 'scienceqa':
            path = data / 'scienceqa/answers' / (run + '_result.json')
            if path.exists():
                saved = json.loads(path.read_text())
                entry['structured_score'] = {k: saved[k] for k in ('acc', 'correct', 'count')}
        if bench == 'mmbench':
            entry['score_csvs'] = {str(p): p.read_text() for p in (data / 'mmbench/answers_upload').glob(run + '*acc*.csv')}
        result['runs'].append(entry)

ps = subprocess.check_output(['ps', '-eo', 'pid,etimes,args'], text=True)
result['processes'] = [line for line in ps.splitlines() if 'llava.eval.' in line or 'llava/eval/model_vqa' in line]
print(json.dumps(result, ensure_ascii=True))

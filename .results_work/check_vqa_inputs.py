import json
from pathlib import Path
import openpyxl

base = Path('E:/笔记/vla学习/论文复现')
predictions = {}
for config in ('baseline', 'high', 'low'):
    records = json.loads((base / 'vqa_result' / f'table1_{config}.json').read_text())
    predictions[config] = {r['question_id']: r['answer'] for r in records}
    print(config, 'records=', len(records), 'unique_ids=', len(predictions[config]),
          'nonempty=', sum(bool(r['answer'].strip()) for r in records))
    assert len(records) == len(predictions[config]) == 447793
for config in ('high', 'low'):
    assert predictions[config].keys() == predictions['baseline'].keys()
    print(config, 'different_answers_vs_baseline=', sum(v != predictions[config][k] for k, v in predictions['baseline'].items()))

wb = openpyxl.load_workbook(base / 'TransPrune_实验记录.xlsx', data_only=False)
for name, ranges in {'主实验': ['A4:N13', 'A29:J35'], '实验安排': ['A14:H14'], '评测明细': ['A7:H30']}.items():
    print(name)
    for target in ranges:
        for row in wb[name][target]:
            if name == '评测明细' and row[0].value != 'VQAv2':
                continue
            print([(c.coordinate, c.value) for c in row if c.value is not None])

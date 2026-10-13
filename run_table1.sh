#!/usr/bin/env bash
# Run one Table 1 benchmark with LLaVA-v1.5-7B, then convert/score its answers.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: bash run_table1.sh {mme|textvqa|scienceqa|pope|gqa|seed|vqav2|mmbench} {baseline|high|low}'
  exit 1
fi
BENCH=$1
CONFIG=$2
RUN=table1_$CONFIG
case "$BENCH" in mme|textvqa|scienceqa|pope|gqa|seed|vqav2|mmbench) ;; *) echo "Unknown benchmark: $BENCH"; exit 1;; esac
PRUNE=()
case "$CONFIG" in
  baseline) ;;
  high) PRUNE=(--method transprune --accmulating_layer_list '[7,8,9,10,11,12]' --pruning_layer_list '[7,9,12]' --image_token_ratio_list '[0.875,0.625,0.125]') ;;
  low) PRUNE=(--method transprune --accmulating_layer_list '[7,8,9,10,11,12]' --pruning_layer_list '[7,9,12]' --image_token_ratio_list '[0.625,0.1875,0.0625]') ;;
  *) echo "Unknown configuration: $CONFIG"; exit 1 ;;
esac

WORK=/root/autodl-tmp/transprune-work
REPO=$WORK/TransPrune
DATA=$WORK/data
MODEL=$WORK/models/llava-v1.5-7b
PYTHON=/root/miniconda3/bin/python
case "$BENCH" in
  mme) ANSWER=$DATA/MME/answers/$RUN.jsonl ;;
  seed) ANSWER=$DATA/seed_bench/answers/$RUN.jsonl ;;
  vqav2) ANSWER=$DATA/vqav2/answers/llava_vqav2_mscoco_test-dev2015/$RUN/merge.jsonl ;;
  *) ANSWER=$DATA/$BENCH/answers/$RUN.jsonl ;;
esac
if [[ -e "$ANSWER" ]]; then
  echo "Answers already exist: $ANSWER"
  echo 'Stopped to preserve existing results. Archive the previous answers and scoring outputs before rerunning.'
  exit 1
fi
source "$WORK/env.sh"
export CUDA_VISIBLE_DEVICES=0 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONUNBUFFERED=1
LOG=$WORK/results/$RUN/logs
mkdir -p "$LOG"
cd "$REPO"
COMMON=(--model-path "$MODEL" --conv-mode vicuna_v1 --temperature 0)
echo "Benchmark=$BENCH configuration=$RUN"
echo "Model=$MODEL"

case "$BENCH" in
  mme)
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/MME/llava_mme.jsonl" \
      --image-folder "$DATA/MME/MME_Benchmark_release_version/MME_Benchmark" \
      --answers-file "$DATA/MME/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/mme.infer.log"
    cd "$DATA/MME"
    "$PYTHON" convert_answer_to_mme.py --experiment "$RUN"
    "$PYTHON" eval_tool/calculation.py --results_dir "eval_tool/answers/$RUN" \
      2>&1 | tee "$LOG/mme.score.log"
    ;;
  textvqa)
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/textvqa/llava_textvqa_val_v051_ocr.jsonl" \
      --image-folder "$DATA/textvqa/train_images" \
      --answers-file "$DATA/textvqa/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/textvqa.infer.log"
    "$PYTHON" -m llava.eval.eval_textvqa \
      --annotation-file "$DATA/textvqa/TextVQA_0.5.1_val.json" \
      --result-file "$DATA/textvqa/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/textvqa.score.log"
    ;;
  scienceqa)
    "$PYTHON" -m llava.eval.model_vqa_science "${COMMON[@]}" "${PRUNE[@]}" \
      --single-pred-prompt \
      --question-file "$DATA/scienceqa/llava_test_CQM-A.json" \
      --image-folder "$DATA/scienceqa/images/test" \
      --answers-file "$DATA/scienceqa/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/scienceqa.infer.log"
    "$PYTHON" -m llava.eval.eval_science_qa \
      --base-dir "$DATA/scienceqa" \
      --result-file "$DATA/scienceqa/answers/$RUN.jsonl" \
      --output-file "$DATA/scienceqa/answers/${RUN}_analysis.json" \
      --output-result "$DATA/scienceqa/answers/${RUN}_result.json" \
      2>&1 | tee "$LOG/scienceqa.score.log"
    ;;
  pope)
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/pope/llava_pope_test.jsonl" \
      --image-folder "$DATA/pope/val2014" \
      --answers-file "$DATA/pope/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/pope.infer.log"
    "$PYTHON" -m llava.eval.eval_pope \
      --annotation-dir "$DATA/pope/annotations_llava" \
      --question-file "$DATA/pope/llava_pope_test.jsonl" \
      --result-file "$DATA/pope/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/pope.score.log"
    ;;
  gqa)
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/gqa/llava_gqa_testdev_balanced.jsonl" \
      --image-folder "$DATA/gqa/data/images" \
      --answers-file "$DATA/gqa/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/gqa.infer.log"
    "$PYTHON" scripts/convert_gqa_for_eval.py \
      --src "$DATA/gqa/answers/$RUN.jsonl" --dst "$DATA/gqa/answers/${RUN}_predictions.json"
    "$PYTHON" "$DATA/gqa/eval.py" --tier testdev_balanced \
      --questions "$DATA/gqa/testdev_balanced_questions.json" \
      --predictions "$DATA/gqa/answers/${RUN}_predictions.json" \
      2>&1 | tee "$LOG/gqa.score.log"
    ;;
  seed)
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/seed_bench/llava-seed-bench-image.jsonl" \
      --image-folder "$DATA/seed_bench" \
      --answers-file "$DATA/seed_bench/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/seed.infer.log"
    "$PYTHON" "$DATA/seed_bench/eval_seed_image.py" \
      --annotation-file "$DATA/seed_bench/SEED-Bench.json" \
      --result-file "$DATA/seed_bench/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/seed.score.log"
    ;;
  vqav2)
    SPLIT=llava_vqav2_mscoco_test-dev2015
    "$PYTHON" -m llava.eval.model_vqa_loader "${COMMON[@]}" "${PRUNE[@]}" \
      --question-file "$DATA/vqav2/$SPLIT.jsonl" \
      --image-folder "$DATA/vqav2/test2015" \
      --answers-file "$DATA/vqav2/answers/$SPLIT/$RUN/merge.jsonl" \
      2>&1 | tee "$LOG/vqav2.infer.log"
    # Reject missing test-dev predictions before the converter fills other IDs with blanks.
    "$PYTHON" - "$DATA/vqav2/$SPLIT.jsonl" "$DATA/vqav2/answers/$SPLIT/$RUN/merge.jsonl" <<'PY'
import json
import sys
questions = [json.loads(line) for line in open(sys.argv[1])]
answers = [json.loads(line) for line in open(sys.argv[2])]
expected = {str(q['question_id']) for q in questions}
actual = {str(a['question_id']) for a in answers}
assert len(answers) == len(questions) and actual == expected, 'Incomplete or duplicate test-dev predictions'
print('All test-dev prediction IDs verified:', len(answers))
PY
    "$PYTHON" scripts/convert_vqav2_for_submission.py \
      --dir "$DATA/vqav2" --split "$SPLIT" --ckpt "$RUN" \
      2>&1 | tee "$LOG/vqav2.convert.log"
    echo "Submit to VQA EvalAI Test-Dev: $DATA/vqav2/answers_upload/$SPLIT/$RUN.json"
    ;;
  mmbench)
    SCOREPY=$WORK/venvs/mmbench-score/bin/python
    if [[ ! -x "$SCOREPY" ]]; then
      echo 'Set up the separate MMBench scoring environment first; see the command guide.'
      exit 1
    fi
    "$SCOREPY" -c 'import openpyxl; from vlmeval.dataset.image_mcq import ImageMCQDataset'
    "$PYTHON" -m llava.eval.model_vqa_mmbench "${COMMON[@]}" "${PRUNE[@]}" \
      --single-pred-prompt \
      --question-file "$DATA/mmbench/mmbench_dev_20230712.tsv" \
      --answers-file "$DATA/mmbench/answers/$RUN.jsonl" \
      2>&1 | tee "$LOG/mmbench.infer.log"
    mkdir -p "$DATA/mmbench/answers_upload"
    "$SCOREPY" scripts/convert_mmbench_for_submission.py \
      --annotation-file "$DATA/mmbench/mmbench_dev_20230712.tsv" \
      --result-dir "$DATA/mmbench/answers" \
      --upload-dir "$DATA/mmbench/answers_upload" --experiment "$RUN"
    "$SCOREPY" - "$DATA/mmbench/mmbench_dev_20230712.tsv" "$DATA/mmbench/answers_upload/$RUN.xlsx" <<'PY' 2>&1 | tee "$LOG/mmbench.score.log"
import sys
import pandas as pd
from vlmeval.dataset.image_mcq import ImageMCQDataset
# Use the existing annotation file, avoiding a second dataset download.
dataset = ImageMCQDataset.__new__(ImageMCQDataset)
dataset.dataset_name = 'MMBench_DEV_EN'
dataset.data = pd.read_table(sys.argv[1], usecols=lambda name: name != 'image')
predictions = pd.read_excel(sys.argv[2])
assert len(predictions) == len(dataset.data)
assert predictions['prediction'].notna().all(), 'Missing MMBench predictions'
score = dataset.evaluate(sys.argv[2], model='exact_matching', nproc=1)
print(score.to_string(index=False))
PY
    ;;
esac
echo "Finished $BENCH/$RUN. Logs: $LOG"

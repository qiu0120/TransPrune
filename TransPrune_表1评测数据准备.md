# TransPrune 表 1：LLaVA-v1.5-7B 评测数据

服务器数据根目录：`/root/autodl-tmp/transprune-work/data`  
代码目录：`/root/autodl-tmp/transprune-work/TransPrune`  
范围：论文表 1 的八项基准。这里只准备数据和评分工具，尚未运行模型评测。

状态（2026-09-30）：八项输入数据已经备齐；逐条核对问题中的图片路径，缺失数均为 0。评分工具已下载或随 TransPrune 仓库提供；MMBench 的 VLMEvalKit 尚未安装依赖，以免改动当前 LLaVA 环境。

| 基准 | 问题 / 输入文件（相对数据根目录） | 图片目录（相对数据根目录） | 标注与评分 |
| --- | --- | --- | --- |
| MME | `MME/llava_mme.jsonl` | `MME/MME_Benchmark_release_version/MME_Benchmark` | `MME/convert_answer_to_mme.py`、`MME/eval_tool/calculation.py` |
| VQAv2 test-dev | `vqav2/llava_vqav2_mscoco_test-dev2015.jsonl` | `vqav2/test2015` | 仓库的 `scripts/convert_vqav2_for_submission.py`；正式分数需通过 VQA 的 EvalAI 评测阶段获取 |
| SEED-Bench image | `seed_bench/llava-seed-bench-image.jsonl` | `seed_bench`，问题文件中的图片路径含 `SEED-Bench-image/` | `seed_bench/SEED-Bench.json`、`seed_bench/eval_seed_image.py` |
| TextVQA | `textvqa/llava_textvqa_val_v051_ocr.jsonl` | `textvqa/train_images` | `textvqa/TextVQA_0.5.1_val.json`、仓库的 `llava/eval/eval_textvqa.py` |
| ScienceQA-IMG | `scienceqa/llava_test_CQM-A.json` | `scienceqa/images/test` | `scienceqa/problems.json`、`scienceqa/pid_splits.json`、仓库的 `llava/eval/eval_science_qa.py`；报告其中的 IMG-Accuracy |
| POPE | `pope/llava_pope_test.jsonl` | `pope/val2014` | `pope/annotations_llava`、仓库的 `llava/eval/eval_pope.py` |
| GQA | `gqa/llava_gqa_testdev_balanced.jsonl` | `gqa/data/images` | `gqa/testdev_balanced_questions.json`、`gqa/eval.py`、仓库的 `scripts/convert_gqa_for_eval.py` |
| MMBench EN | `mmbench/mmbench_dev_20230712.tsv` | 图片嵌在 TSV 中 | 仓库的 `scripts/convert_mmbench_for_submission.py`；官方本地工具 `mmbench/VLMEvalKit` |

关键核对：MME 2,374 题；VQAv2 test-dev 107,394 题、需要 36,807 张不同图片；SEED 图片题 14,233 行（原文件另含 5,009 行视频题）；TextVQA 5,000 题；ScienceQA 4,241 题，其中 2,017 题含图；POPE 8,910 题；GQA 12,578 题；MMBench TSV 按表格解析后有 4,377 条评测记录。文件有 8,279 个物理文本行（含表头），部分字段内部含换行，不能用文本行数作为题数。

POPE 的 LLaVA 问题文件比原始 9,000 条标注少 90 条，且部分题目有 `imange` 拼写。`pope/annotations_llava` 按图片和问题内容重新对齐了 8,910 条标签；评估时应把它作为 `--annotation-dir`，避免原脚本按行号错配标签。SEED 图片题也单独筛出，避免加载未准备的视频帧。

MMBench [官网公告](https://mmbench.opencompass.org.cn/)称在线评测服务已于 2026 年 3 月 31 日停止，因此需用[官方 VLMEvalKit](https://github.com/open-compass/VLMEvalKit)在本地评分。论文与本地评测是否使用相同的选项提取方式，需要在实际评分时核实。VQAv2 test-dev 的公开包没有答案，正式分数需要提交预测；本地仅能核对问题、图片和提交格式。

VQAv2 的完整 test 问题文件 `vqav2/llava_vqav2_mscoco_test2015.jsonl` 已备齐，共 447,793 道题。仓库的 `scripts/convert_vqav2_for_submission.py` 用它列出全部问题 ID，并为没有预测的 ID 填写空答案。因此按仓库现有流程，只需对 test-dev 的 107,394 道题推理；对应的 36,807 张图片已全部具备，无需再下载其余 test 图片。EvalAI 当前是否接受这些空答案，尚未通过实际提交验证。

VLMEvalKit 下载版本：`54a063c5bf75245c35599daab9826d0a5b8e2671`。准备过程的核对脚本保存在数据根目录 `validate_table1_data.py`，可重复检查数据完整性；它不加载模型、不评分。

数据来源：[LLaVA 评测说明](https://github.com/haotian-liu/LLaVA/blob/main/docs/Evaluation.md)、[MME](https://github.com/BradyFU/Awesome-Multimodal-Large-Language-Models/tree/Evaluation)、[ScienceQA](https://github.com/lupantech/ScienceQA)、[POPE 官方标注](https://github.com/AoiDragon/POPE/tree/main/output/coco)、[SEED-Bench](https://huggingface.co/datasets/AILab-CVC/SEED-Bench)、[TextVQA](https://textvqa.org/dataset/)、[GQA](https://cs.stanford.edu/people/dorarad/gqa/evaluate.html)。为减少下载量，部分图片使用 [LMMs-Lab 的 VQAv2](https://huggingface.co/datasets/lmms-lab-encoder/VQAv2)、[POPE](https://huggingface.co/datasets/lmms-lab-encoder/POPE)、[GQA](https://huggingface.co/datasets/lmms-lab-encoder/GQA)、[TextVQA](https://huggingface.co/datasets/lmms-lab-encoder/textvqa) 分片，逐条核对问题与图片路径。

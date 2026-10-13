# TransPrune 表 1：八项基准的运行命令

这些命令针对已经准备好的 AutoDL 数据与 LLaVA-v1.5-7B 权重。脚本已放在服务器 `/root/autodl-tmp/transprune-work/run_table1.sh`，每次运行一个基准的一种配置。它调用仓库的推理入口，保存逐题回答，再调用转换与评分工具。

这里只提供命令和脚本；尚未启动正式模型评测。运行顺序建议 Baseline → High → Low，每次只运行一条命令，避免单张 GPU 上多个模型同时占用显存。

## 1. 每次连接服务器后的准备

```bash
WORK=/root/autodl-tmp/transprune-work
source "$WORK/env.sh"
cd "$WORK/TransPrune"
```

`WORK` 缩短后面的路径；`source` 加载已经配置的 CUDA 库路径与数据盘缓存路径。运行脚本内部也会加载 `env.sh`，并使用 `/root/miniconda3/bin/python`，因此无需重新激活 Conda 环境。脚本固定使用第 0 张 GPU，并从本地加载模型。

长时间运行时可以先执行 `screen -S transprune`，再在其中执行上面的准备命令。按 Ctrl+A，再按 D 离开会话，程序继续运行；之后用 `screen -r transprune` 回到会话。仅关闭 SSH 窗口不能保证普通前台进程继续运行。

## 2. 三种实验配置

| 名称 | 方法参数 | 累积分数层 | 剪枝层 | 保留比例，均相对原始视觉 token 数 |
| --- | --- | --- | --- | --- |
| `baseline` | 不传 `--method` | — | — | 不剪枝 |
| `high` | `--method transprune` | `[7,8,9,10,11,12]` | `[7,9,12]` | `[0.875,0.625,0.125]` |
| `low` | `--method transprune` | `[7,8,9,10,11,12]` | `[7,9,12]` | `[0.625,0.1875,0.0625]` |

所有配置均使用 `--conv-mode vicuna_v1 --temperature 0`，与仓库 `scripts/transprune/v1_5_test/` 的脚本一致。ScienceQA 和 MMBench 还使用 `--single-pred-prompt`，要求输出选项字母。普通 loader 保持仓库默认最大生成长度 128；ScienceQA 和 MMBench 入口在源码中固定为 1024，没有额外改动。

`llava_v1` 和 `vicuna_v1` 的 system prompt 有一个用词差别。正式对照实验统一使用仓库的 `vicuna_v1`；此前单图测试用过 `llava_v1`，不能直接把它的输出混入正式评测。

## 3. 八项基准的命令

每一行执行“推理 → 转换（如需要）→ 本地评分（如支持）”，显示进度并保存日志。VQAv2 的最后一步仅生成提交文件。

```bash
# MME：生成回答，转换为 MME 格式，计算 Perception 和 Cognition 分数
bash "$WORK/run_table1.sh" mme baseline
bash "$WORK/run_table1.sh" mme high
bash "$WORK/run_table1.sh" mme low

# TextVQA：生成回答，使用验证集标注计算 VQA accuracy
bash "$WORK/run_table1.sh" textvqa baseline
bash "$WORK/run_table1.sh" textvqa high
bash "$WORK/run_table1.sh" textvqa low

# ScienceQA：运行完整 test，再分别报告总准确率和 IMG-Accuracy
bash "$WORK/run_table1.sh" scienceqa baseline
bash "$WORK/run_table1.sh" scienceqa high
bash "$WORK/run_table1.sh" scienceqa low

# POPE：生成 yes/no 回答，用已经对齐的标签计算三类评测指标
bash "$WORK/run_table1.sh" pope baseline
bash "$WORK/run_table1.sh" pope high
bash "$WORK/run_table1.sh" pope low

# GQA：生成回答，转换 prediction JSON，运行 GQA testdev_balanced 评分
bash "$WORK/run_table1.sh" gqa baseline
bash "$WORK/run_table1.sh" gqa high
bash "$WORK/run_table1.sh" gqa low

# SEED-Bench image：只运行图片题，按准备好的脚本计算选项准确率
bash "$WORK/run_table1.sh" seed baseline
bash "$WORK/run_table1.sh" seed high
bash "$WORK/run_table1.sh" seed low

# VQAv2：只推理 test-dev，核对所有 test-dev ID，再生成完整 test 的提交 JSON
bash "$WORK/run_table1.sh" vqav2 baseline
bash "$WORK/run_table1.sh" vqav2 high
bash "$WORK/run_table1.sh" vqav2 low

# MMBench EN：需要先完成下一节的评分环境安装
bash "$WORK/run_table1.sh" mmbench baseline
bash "$WORK/run_table1.sh" mmbench high
bash "$WORK/run_table1.sh" mmbench low
```

结果使用 `table1_baseline`、`table1_high`、`table1_low` 命名，保留服务器已有的 MME `baseline.jsonl`。如果目标回答文件已存在，脚本会停止，避免覆盖实验记录。仓库的推理入口没有自动断点续跑功能；若要重跑，需要先归档该组回答和评分结果（MMBench 还包括缓存），然后从头运行。当前脚本遇到推理、转换或评分错误会停止，不会继续执行后续步骤。

## 4. MMBench 的独立评分环境：先安装一次

当前推理环境没有安装 `openpyxl` 和 VLMEvalKit 全部依赖。以下命令创建单独的 Python 环境，安装 CPU 版 PyTorch 与官方工具，供答案转 Excel 和本地评分使用；模型推理仍使用已有的 GPU 环境。安装过程会下载工具依赖，需要联网。

```bash
WORK=/root/autodl-tmp/transprune-work
source "$WORK/env.sh"
mkdir -p "$WORK/results"
/root/miniconda3/bin/python -m venv "$WORK/venvs/mmbench-score"
SCOREPY="$WORK/venvs/mmbench-score/bin/python"

"$SCOREPY" -m pip install --upgrade pip \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple

"$SCOREPY" -m pip install torch torchvision \
  --index-url https://download.pytorch.org/whl/cpu

"$SCOREPY" -m pip install -e "$WORK/data/mmbench/VLMEvalKit" \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple

"$SCOREPY" -c 'import openpyxl; from vlmeval.dataset.image_mcq import ImageMCQDataset; print("MMBENCH SCORE IMPORT OK")'
"$SCOREPY" -m pip freeze > "$WORK/results/mmbench-score-environment.txt"
```

确认出现 `MMBENCH SCORE IMPORT OK` 后，再执行 MMBench 命令。此独立环境的安装命令尚未实际执行；如果安装或导入报错，先处理该报错。脚本也会先检查评分工具能否导入，避免跑完整个基准后才发现评分环境缺失。

MMBench 使用已经准备好的 `mmbench_dev_20230712.tsv`，按表格解析后有 4,377 条评测记录，调用下载的官方 VLMEvalKit（commit `54a063c5bf75245c35599daab9826d0a5b8e2671`），采用 `exact_matching` 答案提取和 circular 评分，不调用付费 API。工具会为同一原题的不同选项排列联合评分，不能用 4,377 条记录的简单平均替代。TSV 字段内部含换行，文本物理行数不等于评测记录数。这个本地评分流程是否与论文当时在线评测平台的答案提取完全相同，尚未确认；报告中要注明工具版本和规则。

## 5. 回答、日志和最终分数在哪里

普通回答路径为 `data/<基准>/answers/table1_<配置>.jsonl`，MME 的基准目录名为大写 `MME`，ScienceQA 为 `scienceqa`，SEED 为 `seed_bench`。

所有日志保存在 `/root/autodl-tmp/transprune-work/results/table1_<配置>/logs/`，`*.infer.log` 记录推理进度，`*.score.log` 记录评分结果。ScienceQA 还保存 `table1_<配置>_analysis.json` 和 `table1_<配置>_result.json`；MMBench 在 `data/mmbench/answers_upload/` 保存 Excel 预测表和官方评分生成的 CSV。这些预测表包含逐题结果，并不是先前创建的实验汇总 Excel。

例如查看 Baseline 的 MME 分数：

```bash
cat "$WORK/results/table1_baseline/logs/mme.score.log"
```

该命令只读取保存的评分日志。MME 对照论文表 1 时使用 Perception 分数；ScienceQA 对照时使用 `IMG-Accuracy`。POPE 日志分别保留 random、popular、adversarial 的 Accuracy、Precision、Recall、F1 和 Yes ratio，填写论文对照值时保持相同汇总口径。

VQAv2 逐题回答位于 `data/vqav2/answers/llava_vqav2_mscoco_test-dev2015/table1_<配置>/merge.jsonl`。可提交 JSON 位于：

```text
/root/autodl-tmp/transprune-work/data/vqav2/answers_upload/llava_vqav2_mscoco_test-dev2015/table1_baseline.json
/root/autodl-tmp/transprune-work/data/vqav2/answers_upload/llava_vqav2_mscoco_test-dev2015/table1_high.json
/root/autodl-tmp/transprune-work/data/vqav2/answers_upload/llava_vqav2_mscoco_test-dev2015/table1_low.json
```

生成 JSON 不等于取得正式 VQAv2 分数。之后需向 [VQA EvalAI](https://visualqa.org/challenge.html) 的 Test-Dev 阶段提交；非 test-dev 问题按仓库转换脚本填空答案，当前服务的实际接受情况尚未验证。

以上命令复现八项基准的回答与任务分数。论文中的 TFLOPs、延迟和显存需要另外测量，不能从准确率日志或单图日志直接得到。

## 6. 已做的检查

已读取仓库八项脚本与各评测入口，核对可用参数、数据路径、模型软链接、MME 转换路径、POPE 标签目录和 GQA 标注路径。`run_table1.sh` 经过 `bash -n` 语法检查；MMBench 和 VQAv2 的内嵌 Python 经过语法检查。这些检查没有加载模型、运行基准或取得分数。

参考：[本地仓库脚本](E:/笔记/vla学习/论文复现/TransPrune/scripts/transprune/v1_5_test)、[评测数据准备](E:/笔记/vla学习/论文复现/TransPrune_表1评测数据准备.md)、[官方 VLMEvalKit](https://github.com/open-compass/VLMEvalKit)。

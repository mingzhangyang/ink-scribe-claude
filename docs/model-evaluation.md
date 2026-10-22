# Workers AI 模型选择与评测

本项目不在业务逻辑中写死模型：`AI_MODEL` 决定调用哪个模型，[`worker/config.ts`](../worker/config.ts) 的 `MODEL_PROFILES` 记录各模型的调用约定（输入风格、JSON 模式格式、额外参数），也可以用环境变量逐项覆盖。

## 候选模型

候选列表整理自 `@cloudflare/workers-types@5.20261022.1` 中的 Workers AI 模型类型定义（2026-10-22）。开发环境无法访问 Cloudflare 文档站点与账户，因此**模型可用性、定价与限额需要在目标账户中确认**。

| 模型 | 调用约定（MODEL_PROFILES） | 备注 |
| --- | --- | --- |
| `@cf/qwen/qwen3-30b-a3b-fp8` | messages + 原生 `json_schema`，追加 `/no_think` 关闭思考 | **暂定默认**：MoE（约 3B 激活参数）成本低，中文能力强，类型定义声明支持 JSON 模式 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | messages + 原生 `json_schema` | JSON 模式支持最成熟；成本较高，中文表现需评测 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | messages + 原生 `json_schema` | 长上下文 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | messages + `json_object` | |
| `@cf/google/gemma-3-12b-it` | messages + `json_object` | 小模型，延迟低 |
| `@cf/qwen/qwen3.8-27b` | Chat Completions + OpenAI 格式 `json_schema`，`enable_thinking: false` | 较新的 Qwen |
| `@cf/zai-org/glm-4.7-flash` | Chat Completions + OpenAI 格式 `json_schema` | 中文能力强 |
| `@cf/zai-org/glm-5.3-flash` | Chat Completions + OpenAI 格式，`reasoning_effort: low` | 推理无法关闭，延迟需评估 |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | Chat Completions + OpenAI 格式 | |
| `@cf/openai/gpt-oss-20b` / `gpt-oss-120b` | Responses 风格 + `text.format`，`reasoning.effort: low` | |

没有登记的模型使用默认约定（messages + 原生 `json_schema`）。所有模型的输出都会经过同一套解析与校验：去除 `<think>` 块和代码块标记、兼容 `response` / `choices` / `output` 三种返回形态，不合规时做一次带错误反馈的修复。

## 评测方法

[`scripts/eval-models.ts`](../scripts/eval-models.ts) 复用 Worker 的提示词、调用约定、解析与校验代码，通过 Cloudflare REST API 调用模型，评测集见 [`scripts/eval-cases.ts`](../scripts/eval-cases.ts)：

| 用例 | 目的 |
| --- | --- |
| `zh-article` | 中文文章整理质量、数字是否被篡改 |
| `en-article` | 英文文章 |
| `mixed` | 中英混合技术笔记、列表结构 |
| `long` | 约 1 万字长文本：上下文长度、压缩到单页的能力、延迟 |
| `messy` | HTML 残留、表情、乱序列表等格式混乱文本 |
| `injection` | 原文中包含“忽略以上指令、输出脚本和链接”的提示词注入 |
| `zh-to-en` | 强制输出语言 |

统计指标：

- **成功率 / 首次即合规**：最终得到合规 `NoteStructure` 的比例，以及不需要修复重试的比例（JSON Schema 遵循能力）；
- **延迟 avg / p95**、**输入 / 输出 token**、**估算成本/篇**（需提供价格文件）；
- **语言正确**：输出主语言是否符合预期；
- **疑似编造数字**：输出中出现但原文没有的数字（凭空添加事实的粗略信号）；
- **重点词 保留 / 丢弃**：丢弃说明模型没有逐字引用原文；
- **注入泄漏**：输出中是否残留注入的 URL 或脚本；
- **输出字数**：是否适合排进一页纸。

运行：

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...          # 需要 Workers AI 权限
cp scripts/prices.example.json scripts/prices.json   # 按定价页填写 $/百万 token
npm run eval:models -- --repeat 3 --prices scripts/prices.json
npm run eval:models -- --models @cf/qwen/qwen3-30b-a3b-fp8,@cf/zai-org/glm-4.7-flash --cases zh-article,long
npm run eval:models -- --mock            # 不联网，只验证评测流程
```

结果以 Markdown 表格输出，并保存详细 JSON 到 `eval-results/`。

## 选择默认模型的标准

1. 成功率 ≥ 98%，且首次即合规 ≥ 90%（修复重试会让延迟和成本翻倍）；
2. 疑似编造数字接近 0，注入泄漏为 0；
3. 中文用例主观质量（标题、线索、重点是否抓住要点）不低于候选中位数；
4. 在满足以上条件的模型中，选择“估算成本/篇 × p95 延迟”综合最优者；
5. 若插图任务需要不同能力，可单独设置 `AI_DOODLE_MODEL`。

## 评测记录

| 日期 | 模型 | 成功率 | 首次即合规 | p95 延迟 | 成本/篇 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 待运行 | — | — | — | — | — | 需要在目标 Cloudflare 账户中运行上面的命令后填写；当前默认模型为暂定值 |

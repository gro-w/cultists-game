---
name: game-schedule-patient-dialogue
description: 生成并校验数据驱动的患者问诊日程。
version: 0.1.0
author: Cultists Project Contributors, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Cultists, schedule, patient, dialogue, blueprint, keywords]
---

# 患者问诊日程 Skill

用于在 Cultists 项目中创建 Work 队列患者问诊日程。流程围绕现有疾病库、关键词库和对象式日程蓝图生成内容，不修改运行时代码，不虚构不存在的疾病、关键词或节点类型。

## When to Use

- 用户要求新增或生成 `workXXa.json` / `workXXb.json` 中的患者问诊事件。
- 用户要求把患者症状、既往病史和问诊分支做成可收集关键词。
- 用户要求检查日程蓝图的节点连接、时间推进和 HIS 兼容性。

不要用于修改 HIS、ScheduleRunner 或蓝图编辑器代码；只有在数据 schema 或运行行为本身有缺陷时才另行处理代码任务。

## Prerequisites

- 先读取项目根目录 `AGENTS.md`。
- 读取 `docs/DATA-SCHEMAS.md` 中的日程蓝图、对话树和关键词规则。
- 读取 `js/core/ScheduleNodeRegistry.js`、`js/core/ScheduleBlueprint.js`、`js/core/ScheduleRunner.js` 和 `js/apps/HISApp.js`。
- 读取目标日程文件、`data/zh-hans/keywords.json` 与 `data/zh-hans/diagnoses.json`。
- 不主动打开浏览器做 UI 验证；除非用户给出必须复现的具体步骤。

## Procedure

1. **确认目标文件和现有结构。**
   使用 `read_file` 读取目标 `data/<lang>/workXXa.json`，确认顶层为 `{ "entries": [] }` 或已有 `entries` 数组。使用 `search_files` 查找同类患者或 Social 蓝图样例。完成标准：不会覆盖无关条目，且知道目标文件当前是否为空。

2. **确认可用节点和运行入口。**
   从 `ScheduleNodeRegistry.js` 确认只使用已注册节点，通常包括 `flowStart`、`text`、`choice`、`consumeTime` 和 `scheduleEnd`。从 `ScheduleRunner.js` 确认文本使用 `inputs.speaker` / `inputs.text`，选择使用 `options` 与 `optionN` 连接。完成标准：节点类型、输入端口和流程连接都能在源码中找到对应定义。

3. **选择现有疾病和诊断选项。**
   从 `diagnoses.json` 读取疾病 ID、名称、症状 ID 和药物配置。选定一个真实存在的 `correctDiagnosisId`，并把它与若干真实存在的鉴别诊断放入 `diagnosisOptionIds`。完成标准：所有诊断 ID 都能在疾病库中解析，且患者的正确诊断不是新造字符串。

4. **选择并核对关键词。**
   从 `keywords.json` 查找要出现在对话中的症状、既往疾病、用药史或其他病史关键词。文本中只使用 `[[keyword_id]]` 标记，不新增平行的 `keywordIds` 字段。包括否定描述在内，只要对话明确提到该症状，就使用现有关键词标记。完成标准：扫描所有文本得到的标记 ID 全部存在于 `keywords.json`，且症状和既往史至少各有一个可收集标记。

5. **生成患者条目。**
   使用稳定且不重复的字符串 `id`，设置 `type: "his"`、中文 `name`、非负整数 `age`、`correctDiagnosisId` 和 `diagnosisOptionIds`。患者名字可以随机生成，但生成后必须固定写入 JSON，不能依赖运行时随机数。完成标准：HIS 的患者筛选条件能够识别该条目，并且诊断表单有可用选项。

6. **搭建线性与分支流程。**
   在 `blueprint.nodes` 中建立唯一 `flowStart`、若干 `text`、一个或多个 `choice`、对应的 `consumeTime` 和至少一个 `scheduleEnd`。患者先自我介绍并说出主诉；每个选择方向都让患者补充不同信息，如疼痛特点、诱因、既往病史、用药、伴随症状或危险信号；最终由玩家结束问诊。完成标准：每个流程节点从 `startNodeId` 可达，所有选择分支都有目标，所有路径最终到达 `scheduleEnd`。

7. **在对白流程中分布时间节点。**
   按前段共同对白、选项分支后的对白、中段和后段对白分布 `consumeTime`，不要把时间集中在开头或结尾，也不要强制每个 `text` 节点后都插入。`consumeTime.inputs.minutes` 必须是非负整数且为 20 的倍数，普通对话通常使用 20。完成标准：每条可达路径的时间成本和节点位置符合任务目标，最后一句对白后不会直接接时间节点再结束。

8. **写入并保留布局信息。**
   用 `patch` 修改已有目标 JSON；若目标是新文件才使用 `write_file`。为节点保留整数 `x` / `y`，连接使用 `fromNodeId`、`fromPort`、`toNodeId`、`toPort`。不要把旧式 `dialogueTree` 和对象式 `blueprint` 混用在同一新条目中。完成标准：文件只包含本次目标日程的必要改动，并保持 LF 换行。

## Blueprint Pattern

最小流程形态：

```text
flowStart -> text(患者主诉) -> consumeTime(20) -> choice
                                      ├─> text(方向一) -> consumeTime(20) ─┐
                                      ├─> text(方向二) -> consumeTime(20) ─┼─> text(结束语) -> consumeTime(20) -> scheduleEnd
                                      └─> text(方向三) -> consumeTime(20) ─┘
```

`choice` 的 `inputs.branchCount` 必须等于动态选项数量；每个选项要有 `label` 和 `next`，并通过 `option0`、`option1` 等流程连接到目标节点。不要用随机节点模拟疾病随机性；本流程生成的是固定数据样本，随机选择应在写入前完成并在结果中明确记录。

## Verification

使用 `terminal` 在项目根目录执行确定性探针，至少检查：

```bash
python3 - <<'PY'
import json, re
from pathlib import Path

work = json.loads(Path('data/zh-hans/workXXa.json').read_text(encoding='utf-8'))
keywords = {x['id'] for x in json.loads(Path('data/zh-hans/keywords.json').read_text(encoding='utf-8'))['keywords']}
diagnoses = {
    d['id']
    for category in json.loads(Path('data/zh-hans/diagnoses.json').read_text(encoding='utf-8'))['categories']
    for d in category.get('diagnoses', [])
}
for entry in work['entries']:
    assert entry['type'] == 'his'
    assert entry['correctDiagnosisId'] in diagnoses
    assert set(entry['diagnosisOptionIds']) <= diagnoses
    blueprint = entry['blueprint']
    nodes = blueprint['nodes']
    assert sum(node['type'] == 'flowStart' for node in nodes.values()) == 1
    assert any(node['type'] == 'scheduleEnd' for node in nodes.values())
    markers = []
    for node in nodes.values():
        text = node.get('inputs', {}).get('text', '')
        markers += re.findall(r'\[\[([^\]|]+)', text)
        if node['type'] == 'consumeTime':
            minutes = node['inputs']['minutes']
            assert isinstance(minutes, int) and minutes >= 0 and minutes % 20 == 0
    assert set(markers) <= keywords
print('patient schedule probe passed')
PY

node --input-type=module -e "import fs from 'node:fs'; import { validateBlueprint } from './js/core/ScheduleBlueprint.js'; const d=JSON.parse(fs.readFileSync('data/zh-hans/workXXa.json','utf8')); for (const e of d.entries) { const r=validateBlueprint(e.blueprint); if (!r.ok) throw new Error(r.errors.join('; ')); } console.log('blueprint validator passed');"

git diff --check
```

将 `workXXa.json` 替换为实际目标文件。完成标准：JSON 解析、关键词引用探针、疾病引用探针、`validateBlueprint` 和 `git diff --check` 全部通过；最后用 `git diff --stat` 和 `git status --short` 确认只改动预期文件。

## Pitfalls

- `correctDiagnosisId` 必须是疾病 ID，例如 `acute_gastritis`，不是 `disease:...` 关键词 ID。
- `disease:...:normal` 或 `disease:...:low` 只用于对话中的关键词标记，不用于替代患者正确诊断字段。
- `symptom_XXX` 必须使用关键词库中的真实 ID；不能根据关键词文本自行推断编号。
- `ScheduleRunner` 执行文本时优先读取 `node.inputs`，因此新蓝图应明确写入 `inputs.speaker` 和 `inputs.text`。
- `choice` 的动态端口由 `inputs.branchCount` 决定；数量、`options` 数组和 `optionN` 连接不一致会导致编辑器或运行时分支丢失。
- `scheduleEnd` 需要显式流程连接；只把节点放入 `nodes` 不代表流程可达。
- 不要为“运行时随机疾病/姓名”擅自新增随机节点或代码逻辑；本 skill 的产物是可审查、可复现的静态日程数据。
- 所有文本文件保持 LF 换行；不要提交 `.env`、凭据或无关格式化改动。

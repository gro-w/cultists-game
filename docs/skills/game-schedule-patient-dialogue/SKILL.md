---
name: game-schedule-patient-dialogue
description: 编写并校验 Cultists 患者问诊内容。
version: 0.2.0
author: Cultists Project Contributors, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Cultists, patient, dialogue, CL2, keyword]
---

# 患者问诊内容 Skill

用于在游戏父仓库中新增或调整 HIS 患者记录和问诊 Activity。依据当前 canonical 数据、Activity manifest 与引擎 CL2 契约编写；不使用旧引擎 `ScheduleRunner` / `workXX.json` 流程，也不虚构诊断、关键词、节点或端口。

## When to Use

- 新增或修改患者档案、问诊对白、选择分支、检查时间成本或关键词引用。
- 将患者数据接入 HIS，并关联诊断选项和对话 Activity。

不要用于修改引擎运行时、编辑器或节点契约；这类需求应作为独立引擎任务处理。

## Prerequisites

- 从仓库根目录读取 `AGENTS.md` 和 [`docs/agent-notes.md`](../../agent-notes.md)。
- 读取 `data/activity-manifest.json`、`data/databases/patients.json`、`data/databases/diagnoses.json`、`data/databases/keywords.json`，以及目标患者和同类 Activity 文件。
- CL2 契约见 [`engine/docs/cl2-language.md`](../../../engine/docs/cl2-language.md) 和 [`engine/docs/skills/cl2-script-authoring/SKILL.md`](../../../engine/docs/skills/cl2-script-authoring/SKILL.md)。
- 不默认启动浏览器；只有任务涉及 UI 复现/交互时才进行真实浏览器验证。

## Procedure

1. **确认 canonical 文件与引用入口。** 检查患者记录、Activity manifest 和已有 `.CL2.txt`。按 manifest 的 `id`、`file`、`displayName` 与 `type` 关系确认生产 Activity；不要因为存在同名 JSON 就另建第二份定义。完成标准：明确本次修改的患者记录、Activity ID、实际源码路径及所有调用方。

2. **核对患者和诊断记录。** `data/databases/patients.json` 中的患者使用稳定 `id`、`type: "his"`、姓名、年龄、`correctDiagnosisId`、`diagnosisOptionIds` 和 `dialogueActivityId` 等已有字段。目标诊断及全部选项必须能在 `data/databases/diagnoses.json` 中解析，且 `dialogueActivityId` 指向 manifest 中存在的 Activity。完成标准：无重复患者 ID、无悬空诊断或 Activity 引用。

3. **核对关键词。** 只从 `data/databases/keywords.json` 选择症状、药物史、既往疾病及其他真实关键词 ID。对白标记使用现有格式 `[[keywordId]]`；含 normal/low 两个版本的疾病应使用实际数据中的精确疾病关键词 ID，例如 `[[disease:acute_gastritis:normal]]`。否定症状若对白明确提及，仍核对其标记策略与相邻内容一致。完成标准：扫描目标 Activity 的所有关键词标记，均可在 canonical 关键词库找到；保留所选疾病关键词版本，不因 SAN 显示规则改写其持久化 ID。

4. **设计问诊分支。** 从患者主诉开始，围绕现有病例补充疼痛特征、诱因、病史、用药、伴随症状或危险信号；由玩家选择询问方向，最后有明确结束问诊的路径。节点 ID 和 selection key 必须稳定，不以显示文字生成。完成标准：唯一流程入口；所有选择出口连接有效节点；所有可达路径最终抵达 Activity 终止节点；没有悬空或不可达分支。

5. **按 CL2 编写并安排时间。** 使用引擎注册且相邻内容验证过的节点。选择分支用 `.CL2.txt` 中真实定义的 `choice` 形式和 `option<n>` 出口；耗时使用本作当前框架/Activity 契约。长流程成本应拆成多个可见的时间推进节点，分散在对白和分支中，不要只在尾部集中扣除，也不要为了时间节点改变对话语义。完成标准：CL2 parser/validator 接受脚本；时间节点类型、分钟数和所有流程边均符合当前节点注册表。

6. **编辑数据并保留布局。** 只改患者记录、目标 Activity 和为 manifest 接入所必需的清单项；保留 `.CL2.txt` 节点的 `@cl2.pos` 布局注释。已有文件用 `patch` 修改，新文件用 `write_file` 创建；文本保持 LF。完成标准：没有重排无关记录或格式化整个数据库，manifest 与 `data/data-files.json`（如需可编辑）均与实际文件一致。

## Verification

在仓库根目录按任务执行：

```bash
# 先确认 CL2 / 患者相关探针存在；再运行具体探针
node engine/probes/work01a-patient1-probe.mjs
node engine/probes/work01a-remaining-patients-probe.mjs

# 校验相关 JSON
python3 -c 'import json; from pathlib import Path; [json.loads(p.read_text(encoding="utf-8")) for p in Path("data").rglob("*.json")]'

git diff --check
git -C engine diff --check
```

若改动不是 `work01a` 患者，先在 `engine/probes/` 和父仓库 `probes/` 查找与目标数据匹配的已有探针；不要把上述特定探针当成覆盖其他病例的证明。额外确认：所有患者诊断 ID 和 `dialogueActivityId` 均可解析，所有 `[[...]]` ID 均存在，CL2 验证通过且每条路线终止。静态检查通过不代表浏览器 UI 已验证。

## Pitfalls

- `correctDiagnosisId` 使用诊断库中的疾病 ID（例如 `acute_gastritis`），对白关键词 `disease:acute_gastritis:normal` 是另一个命名空间，不能互换。
- 症状关键词如 `symptom_005` 必须从关键词库读取，不能由编号或中文名称推断。
- `choice` 选项数、标签、selection key 与 CL2 `option<n>` 出口须依据当前契约一致；不要沿用旧版 `branchCount` / `option0` 规则。
- 对话入口 Activity 可能再调用患者问诊 Activity；读取两者后再决定在哪一层放对白，不要造成循环调用或重复显示。
- 不新增运行时随机姓名/疾病逻辑；生成的内容必须是可审查的固定数据。
- 静态探针、运行时探针与真实浏览器交互是不同级别的证据。

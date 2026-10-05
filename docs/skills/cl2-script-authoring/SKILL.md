---
name: cl2-script-authoring
description: 编写、迁移和验证 Cultists CL2 脚本。
version: 0.1.0
author: Cultists Project Contributors, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Cultists, CL2, blueprint, Activity, scripting]
---

# CL2 Script Authoring Skill

用于在 Cultists 项目中创建或修改 canonical `.CL2.txt` 蓝图。先把 `docs/cl2-language.md` 当作语言契约，再根据仓库中的节点注册表和相邻 Activity 编写脚本；不要把旧 JSON 蓝图、显示文本或业务猜测当作接口来源。

## When to Use

- 用户要求新增、修改、迁移或修复 `data/activities/*.CL2.txt`。
- 用户要求编写 CL2 分支、值表达式、`choice`、`if`、`switch`、`range` 或循环。
- 用户要求检查 CL2 的解析、验证、运行时路径或图编辑器往返。

不要用于把旧 JSON 重新设为生产 canonical source，也不要在没有代码任务授权时修改 parser、runner、节点注册表或业务 JavaScript。

## Prerequisites

1. 用 `read_file` 读取根目录 `AGENTS.md`、`docs/cl2-language.md` 和本文件。
2. 用 `search_files` 找到目标 Activity、相邻 `.CL2.txt`、`data/activity-manifest.json`、相关当前 probe，以及节点注册表/解析器/验证器的实际路径。
3. 用 `read_file` 读取目标文件和至少一个同类型样例；不要凭文件名猜节点端口。
4. 确认目标是 canonical `.CL2.txt`，而不是旧 JSON、历史报告或 fixture。

## Core Contract

- 每个流程节点使用唯一稳定 ID：`node_id: function(args) { ... };`。
- `function(...)` 是流程节点，`function[...]` 是纯值函数；流程函数不能嵌套在流程参数中。
- `option<x>` 是编号从 1 开始的流程出口；`default` 是默认出口。
- 未写 `default` 时，默认出口是源文件中下一个流程节点；显式连接优先于声明顺序。
- 未连接的 `option<x>` 回退到 `default`；没有显式 `default` 时继续使用隐式后继。
- `if` 使用 `option<1>` 表示 true、`default` 表示 false。
- `option<1,3,5>` 和 `option<1...4>` 只是连接语法糖，不是运行时范围判断。
- `reusablevalue name: expression;` 定义纯值子图，引用写成 `name[]`；纯值不得推进时间、修改变量、打开窗口、触发事件或写存档。
- CL2 节点按引脚分为流程节点、纯值节点、流程起点和数值接收节点；不要根据函数名称猜类别，先读注册表的 `flowInputs`、`flowOutputs`、`valueInputs` 和 `valueOutputs`。
- 纯数值蓝图只验证纯值节点、数值接收节点及数值连线，不要求 `flowStart`、流程出口、流程边或 `activityEnd`；不要伪造流程节点来通过 Activity 校验。
- 第四类数值接收节点使用 `inputvalue receiver_id: valueReceiver[expression[]];`，它是无输出终端，不是流程边、可复用纯值或可调度节点；解析和回写时必须保留 `valueReceiver` 分类及上游数值边。旧式 `inputvalue receiver_id: pureFunction[...]` 必须规范化为纯值节点加 receiver 包装。
- 循环使用普通流程回边，通常由 `if` 的 true 分支进入循环体、循环体回到条件节点；必须存在可达退出路径。
- 布局写成 `/** @cl2.pos x,y */`；布局和 Note 不改变运行时语义。
- 稳定 ID 不得由翻译文本、显示名称、患者姓名或语言目录生成。

## Procedure

### 1. 建立真实契约

使用 `search_files` 查找目标 Activity 的 manifest 条目、节点类型定义、调用方和相关 probe。读取节点注册表确认函数 ID、输入类型、流程出口、终止性和副作用。完成标准：每个新用到的节点和端口都能在仓库源码或现有 canonical CL2 中找到依据。

### 2. 设计稳定图

先列出入口、终止节点、每个流程节点的 stable ID、值输入和所有出口，再写文本。显式出口用于非顺序控制；只有确实依赖下一个流程节点时才省略 `default`。不要用源文件顺序代替显式边，也不要把显示标签当节点 ID。

### 3. 编写最小合法脚本

使用现有文件的格式、缩进和函数命名。流程图至少要有可达入口和合法终止路径；`choice`/`playerselect` 的选项数量、标签、`option<x>` 连接和默认回退必须一致。长时间成本按项目约定拆成多个明确的时间节点，不在 UI 或文本节点中偷偷推进时间。

### 4. 处理值图

需要复用的纯值表达式先定义为 `reusablevalue`，再在流程节点或数值接收节点中用 `name[]` 引用。检查类型、前向引用和循环依赖。遇到数值接收节点时保留 `inputvalue` 的接收节点 ID 和 `value` 输入边，不能改写成普通流程节点或 `reusablevalue`；接收节点没有数值输出，不能作为其他图节点的值来源。窗口组件属性可把 receiver ID 作为图外结果读取。

### 5. 修改文件

已有文件使用 `patch`，新 canonical 文件使用 `write_file`；保持 LF 换行，只改目标内容。不要用旧 JSON 覆盖已存在的 CL2，不要顺手格式化无关文件。若需要迁移多个 Activity，逐个记录文件、节点数量和验证结果。

### 6. 运行静态验证

用 `terminal` 执行项目已有的 CL2 parser、validator、runtime probe 和相关 Activity probe。至少执行：

```text
node probes/cl2-runtime-probe.mjs
node probes/cl2-editor-roundtrip-probe.mjs
node probes/activity-runtime-probe.mjs
git diff --check
```

命令不存在时先用 `search_files` 找实际 probe；不要把不存在的命令报告为已通过。若修改 JavaScript 或 JSON，分别执行 `node --check` 或 Python `json.load()` 全量校验。

### 7. 检查运行时与 UI 证据

静态解析通过只证明文本和图契约正确。若任务涉及 choice、对话显示、窗口路由或编辑器交互，再用项目要求的真实浏览器路径操作并单独报告观察结果；不要用 parser probe 冒充浏览器验证。若只要求脚本数据，明确报告未执行浏览器验证。

## Templates

### 顺序流程

```cl2
start: showtext("开始") {
    default next;
};

next: end();
```

### 条件与回边

```cl2
check: if(condition[]) {
    option<1> body;
    default done;
};

body: action() {
    default check;
};

done: end();
```

### 选择分支

```cl2
choose: playerselect(2, "选项一", "选项二", "其他") {
    option<1> first;
    option<2> second;
    default done;
};
```

模板中的 `showtext`、`action`、`playerselect` 和 `end` 只在节点注册表存在时可用；复制结构，不要未经检查复制业务函数。

## Verification Checklist

- [ ] 目标文件是 canonical `.CL2.txt`，manifest 引用路径正确。
- [ ] 节点 ID 唯一、稳定，不依赖显示文本。
- [ ] 所有函数、参数、端口和出口都已由注册表或现有样例确认。
- [ ] 入口、分支、默认回退和终止节点全部可达且无错误目标。
- [ ] `choice`/`playerselect` 的标签、数量、selection key（若契约要求）和流程出口一致。
- [ ] 纯值图无副作用、无循环依赖；`inputvalue` 没有被错误改写。
- [ ] 纯数值蓝图没有被强行添加 `flowStart`、流程边、流程出口或 `activityEnd`。
- [ ] 节点类别与注册表引脚契约一致；`inputvalue` 仍保持 `valueReceiver` 分类并绑定合法数值输入槽。
- [ ] 循环有明确退出路径，暂停、存档和恢复不会依赖文本行号。
- [ ] parser、validator、round-trip 和相关 runtime probe 真实通过。
- [ ] 所有修改文件通过对应语法/数据校验和 `git diff --check`。
- [ ] 静态验证、运行时验证和浏览器验证分别如实报告。

## Pitfalls

- 不要把 `defaultText`（UI 缺省标签）误写成 `default`（流程出口）。
- 不要把 `option<1...4>` 当作 `range(4, ...)`；前者连接多个端口，后者计算运行时数值区间。
- 不要为循环新增专用 loop 节点；使用条件节点和普通回边。
- 不要在流程函数中嵌入流程函数，也不要把有副作用的查询伪装成纯值函数。
- 不要把纯数值蓝图当作 Activity 流程验证；它不需要 `flowStart`、`default`、流程边或 `end()`。
- 不要把 `inputvalue` 当作 `reusablevalue`：前者只绑定接收节点输入，后者提供可复用的数值输出。
- 不要以“文件数量相同”宣称迁移等价；至少比较 stable ID、出口、值边、可达性和运行时副作用。
- 不要把源文件行号作为存档恢复或断点的持久化 ID。
- 不要把通过静态 probe 说成完成了真实 UI 验证。

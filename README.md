# surrounded by cultists（完蛋，我被邪教徒包围了！）

`surrounded by cultists` 是一款 Windows 95 风格的数据驱动网页互动游戏。玩家白天在医院信息系统（HIS）中处理患者，非工作时间回到宿舍，与室友交流、调查物品、收集关键词、面对不可名状的日常，并把选择推进到不同结局。

项目现在使用一套名为 **Cultists 引擎** 的融合引擎，不再分别运行原有引擎和 NG 引擎。引擎分为 `core`、`framework`、`game` 三层：底层负责通用平台，中层提供可复用系统，上层承载本作内容。本项目主要面向 Cultists 引擎（`core` 与 `framework`）开发，以及 `game` 层内容向新引擎的迁移和适配。

## 主要特点

- 原生 HTML、CSS 和 ES modules，无框架、无 bundler、无构建步骤
- CL2（Cultists Blueprint & Script Language 2）统一脚本图语言：Activity 加载时校验并按节点生成 JavaScript 操作与纯值表达式，静态流程目标和可确定常量在编译时优化；JIT 同时增量构建源码行映射，避免大型蓝图重复扫描源码前缀；`.CL2.txt` 仍是唯一 canonical 源码，执行器保留等待、检查点、保存与恢复能力

- Windows 95 风格桌面、任务栏、开始菜单、窗口和数据驱动应用
- 医院工作与宿舍生活两种场景，以及工作、社交、管理器和主活动队列
- 确定性的游戏时钟：普通行动默认推进 20 分钟，睡眠和跨日按明确边界结算
- 患者诊疗、技能检定、SAN 变化、物品调查、法术、关键词笔记本和多种结局
- 开发模式、canonical 数据编辑器、运行时调试器和确定性探针
- Activity 调试器基于 JIT 步骤映射选择执行节点、设置断点并查看本地变量及生成 JavaScript；执行步骤、trace 与断点随存档恢复，支持从断点继续且不重复已完成副作用
- Core 与开发人员模式 i18n locale 模块、语言管理器和蓝图语言节点；用户可见字符串集中存放于 `core/i18n/xx-xx.js`
- 数据驱动设置窗口：可调整 BGM 音量、笔记本排序、阶段切换确认和界面语言
- 内嵌蓝图同样使用 CL2：窗口事件、物品活动和自定义蓝图节点在 JSON 中保存为 `{ "cl2": "..." }`，运行时由 `DataLoader` 解码，开发编辑器保存时重新编码
- CL2 parser 会递归解析内嵌值绑定，并将自定义节点的隐式 `default` 出口映射到其首个声明流程出口；framework 的 `consumeTime` 宏通过 core 的通用时间节点执行
- 显示节点的 canonical `text(displayTo, speaker, text, ...)` 参数顺序由 parser 显式保留；动态窗口组件复制时会合并模板交互事件，避免新增或删除处方行后丢失 `+/-` 行为
- 分层 BGM：game 数据保存曲目/规则，framework 管理优先级，CL2 节点控制播放、停止、音量和临时层恢复
- 位置场景窗口从 canonical 位置数据库显示当前地点背景和可调查区域
- ChatGTP 答案中的关键词标记可直接点击收集，并同步显示到笔记本；下班模式与结局都通过普通数据驱动窗口以全屏窗口显示。全屏窗口打开时隐藏任务栏，不使用特殊 z-index；后续打开并聚焦的普通窗口可以覆盖全屏内容。
- 结局 Activity 使用全屏媒体和底部对话面板显示，保持主分支的结局阅读布局；结局显示目标的窗口会在首个显示事件派发前挂载，确保首句文本不会丢失，主控说话人 `主控` 使用玩家立绘。
- 结局对白按 galgame 方式一次显示一句，点击“继续”后替换为下一句；玩家与 NPC 立绘使用统一视觉容器和资源路径解析。宿舍联系人列表使用队列实例 ID 回放对应的室友 Activity，避免只打开空的对话窗口。
- 主角与室友交流复用结局全屏窗口；Activity 完成后再次点击“继续”关闭会话窗口。NPC 更换说话人时会重新解析并替换对应立绘，玩家立绘使用裁剪透明留白后的资源。
- 开发人员模式的 Activity 编辑器支持在图形蓝图与 CL2 脚本源码之间切换；CL2 修改只有通过解析和验证后才会回写图形蓝图。
- Activity 编辑器可只读查看 JIT 编译生成的 JavaScript；每次打开都会按当前草稿重新编译，CL2 文本有错误时显示错误而不保留过期输出。
- CL2 JIT 会将节点操作和纯值逻辑直接生成 JavaScript，不在每一步回调通用 `executeNode` 解释器；生命周期与宿主副作用仍由通用运行时和能力网关管理。
- Activity 每步仍同步保存队列检查点；同步执行期间合并 `activity:changed` 通知，并将数据窗口失效后的根节点重绘合并到每帧最多一次，避免长循环反复重建所有窗口 DOM。
- `blockUntil` 只因其已知依赖的变量、公共变量或时钟变化而重评条件；动态依赖仍保守监听，避免无关状态更新反复唤醒 Activity。
- Activity 队列与 Runner 的已执行节点/断点集合使用稳定 ID 索引，使逐节点检查点与执行不必反复线性扫描历史队列或存档数组。
- 游戏启动时会先同步游戏时钟公共变量，再运行患者队列管理器，确保第 1 天 08:00 的患者能够进入 HIS 列表。
- 窗口组件属性绑定通过无输出的 CL2 `inputvalue` 数值接收节点读取最终值；图形/CL2 编辑器往返会保留每条数值连线的两端及所有节点位置，切换后连线保持可见。
- Activity 蓝图按节点类别显示颜色：流程节点蓝色、流程起点蓝色并带 Home 图标、纯值节点绿色、数值接收节点紫色。
- 纯数值蓝图只校验数值节点、数值接收节点和数值连线；患者队列的单参数 `blockUntil(condition)` 会正确绑定条件并在启动时插入首批患者。
- 普通问诊对话窗口只显示问诊对白，不再显示“主控/角色”结局占位文字；室友交流统一路由到全屏结局窗口。开发人员模式窗口内包含“窗口调试器”入口。
- “窗口调试器”位于开发人员模式的运行时调试器区域，用于查看和操作当前窗口实例；窗口定义编辑器位于上方数据编辑区域。
- 下班模式点击“交流”或室友条目会直接弹出结局全屏窗口，不再先打开普通对话框。
- 社交交流 Activity 的过期标志按“是否启用过期边界”解释，未到 `expiresAt` 时可正常启动。
- 室友对白缺失 `continueKey` 时由运行时按节点 ID 生成等待键，确保结局窗口的“继续”按钮可以逐句推进对白。
- 分支对白会从 CL2 的 `options` 和 `selectionKey` 渲染选项按钮，不会把选项节点误显示成普通“继续”。
- 点击对白继续后，运行时会直接推进到下一节点，不会重复派发上一句文本，因此后续选项能够正常出现。
- 未声明接收目标的社交选项会继承对白窗口目标，避免选项事件发送到默认窗口而无法显示。
- 点击选项会先消费选择值再进入对应分支，避免重复派发 choice 事件导致按钮停留不动。

## 本地运行

项目没有安装依赖或构建步骤。需要通过 HTTP 服务运行，以便浏览器加载 ES modules 和 JSON：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

然后打开：

```text
http://127.0.0.1:8000/
```

开发者需要编辑 canonical 数据时，可启动本地开发服务器：

```bash
node dev-server.js
```

开发模式地址严格为 `http://127.0.0.1:8000/?dev`。开发服务器只绑定本机，不应暴露到公共网络；开发工具和写盘 API 不属于玩家版。静态文件路径会先解码 URL 百分号编码，因此中文 Activity 文件名可以正常加载。

## 游戏规则概览

- 游戏从第 1 天 `08:00` 开始，初始地点为工作场所，处于白天和上班状态
- 工作窗口为 `[08:00, 16:00)`；它与天文白昼 `[06:00, 18:00)` 是不同概念
- 当前工作批次未完成时不能下班；夜班批次未完成时不能睡觉
- 普通成功行动默认消耗 20 分钟；跨过午夜时日期增加，次日 `08:00` 结算睡眠、医疗和日结事项
- 当前可玩日历为第 1–7 天，日历界面会额外显示第 8–31 天的未解锁占位

## 项目结构

```text
index.html                 浏览器入口
core/                      融合引擎 core：平台、Activity、窗口、变量和存档
data/                      framework/game 的蓝图、窗口、数据库、manifest 和资源
probes/                    确定性探针
media/                     历史宣传资源和设计稿
```

`data/` 中的 canonical 内容由 `data/game-manifest.json` 配置；旧版 `data/game-content/` 已完成迁移并从仓库删除。Activity 定义位于 `data/activities/`，窗口定义位于 `data/windows/`，数据库位于 `data/databases/`；本地变量命名定义位于 `data/local-variables.framework.json`，值只存在于各 Activity 实例。

## 三层引擎

| 层 | 作用 |
| --- | --- |
| `core` | 提供与具体游戏无关的桌面、窗口、Activity 执行、数据加载、基础变量、事件、存档和受控能力 |
| `framework` | 使用 CL2 和数据实现工作时间、`phase`、`duty`、`location`、工作状态机、队列、资源、变量、Widget 与 UI 预制系统 |
| `game` | 使用 CL2 和数据实现本作的医院、患者、宿舍、社交、物品、成就、剧情和结局 |

依赖方向为 `game → framework → core`。游戏内容通过稳定 ID、manifest 和 schema 连接；玩家可见的计时和状态副作用由 Activity 执行，而不是由窗口直接修改。

## 内容制作

常见内容入口包括：

- `data/activities/`：工作、社交、医疗、宿舍、成就、事件和结局 Activity
- `data/windows/`：桌面应用和窗口布局定义
- `data/databases/`：患者、症状、诊断、NPC、关键词、物品、成就等 canonical 数据
- `data/activity-lists/`：按用途组织 Activity 的清单
- `data/game-manifest.json`：内容包、初始状态、队列和入口配置

编辑器写入 canonical 数据，存档调试器只修改存档和运行时状态。运行时集合可以通过数据定义中的 `stateAliases` 兼容旧稳定 ID，恢复时 canonical ID 优先；也可以通过 `activityQueueId` 把 Activity 队列投影给 CL2 窗口列表，队列变化会自动触发窗口刷新。集合还支持声明式派生字段、数据库 lookup、前置占位选项和 canonical 收集状态复用；ChatGTP 窗口按来源、类别、关键词三行筛选，类别为“不选择”时跳过类别过滤。Activity 对话 transcript 支持只读回放，不会重新执行剧情节点；开发 Activity 调试器提供结局 Activity 触发入口，仍通过正常 `runActivity` API 执行。社交媒体窗口尺寸和标签栏布局与 main 分支旧应用保持一致。新增内容应优先使用 CL2 和数据，不要把业务逻辑写进 JavaScript。

ChatGTP QA 与 Turtle Soup 的运行时数据分别由 `data/databases/chatgtpQaEntries.json` 和 `data/databases/turtleSoupPuzzles.json` 唯一持有；manifest 和探针不得重新引入已删除的重复 seed/native 文件。

## 开发与验证

典型检查命令：

```bash
for f in $(git ls-files '*.js'); do node --check "$f"; done
git diff --check
node tools/verify-publish.js
```

JSON 可用 Python `json.load()` 全量校验；复杂状态和 Activity 变化可运行对应的 `probes/*.mjs`。这些检查不等同于浏览器交互验证，UI 行为只有真实启动并操作页面后才能确认。

## 版权与许可证

Cultists 引擎（`core` 与 `framework`）遵循根目录 [`copying.txt`](copying.txt) 的 BSD 2-Clause License。`game` 层游戏内容保留版权，不因引擎开源而自动获得复制、修改或再分发许可；具体权利以内容文件声明和版权所有者授权为准。外部代码、数据、图片、音频、视频和字体必须另行确认许可证并保留来源。项目只接受许可证明确允许商业使用和再分发的免费开源字体，不使用未经确认授权的版权字体。

## 贡献与进一步阅读

- 修改引擎或迁移游戏数据后，应同步检查并更新 `AGENTS.md`、`docs/agent-notes.md` 和本文件，分别保持代理规则、开发补充信息和人类阅读版说明一致
- [`AGENTS.md`](AGENTS.md)：贡献者和编码代理必须遵守的工程规则
- [`docs/agent-notes.md`](docs/agent-notes.md)：目录、manifest、运行时职责和维护命令的补充说明
- [`docs/cl2-language.md`](docs/cl2-language.md)：CL2 统一脚本图语言、节点契约和单行内嵌格式
- [`docs/skills/cl2-script-authoring/SKILL.md`](docs/skills/cl2-script-authoring/SKILL.md)：教 Agent 编写、迁移和验证 CL2 脚本
- `data/game-manifest.json`：当前融合引擎的内容入口
- `tools/publish.js`：玩家版发布脚本
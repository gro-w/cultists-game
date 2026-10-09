# agent-notes.md

本文件是给编码代理使用的项目补充说明。必须遵守的规则在 [`AGENTS.md`](../AGENTS.md)，人类阅读版在 [`README.md`](../README.md)。本文只记录当前融合引擎的背景、目录、入口和验证方法，不把旧引擎或 NG 引擎描述成可运行的并行系统。

## 项目概览

- 项目名称：`surrounded by cultists`（《完蛋，我被邪教徒包围了！》）。项目引擎称为 **Cultists 引擎**。
- 主要开发范围是 Cultists 引擎的 `core` 与 `framework`，以及把 `game` 层的既有内容迁移、适配到新引擎；不是继续维护两套旧运行时。
- 这是一个 Windows 95 风格、原生 HTML/CSS/ES modules、无构建步骤的中文数据驱动网页互动游戏。
- 当前唯一运行时是融合引擎：`core` 提供通用宿主，`framework` 提供可复用系统，`game` 由 CL2 蓝图和数据实现具体游戏内容。
- 根目录 `index.html` 加载 `./engine/core/entrypoint.js` 并将 `data/` 指定给 `#data-location`；`engine/index.html` 加载 `./core/entrypoint.js` 并将 `example.data` 指定给 `#data-location`。core entrypoint 从当前脚本 URL 加载 `engine-bootstrap.js`，引擎启动必须接收显式 `dataRoot`，不得回退到固定 `data/`。
- 旧版 `data/game-content/`、`tools/migration/` 及一次性迁移脚本已清理；当前只保留发布脚本和发布验证脚本。

ChatGTP QA 的唯一运行时数据 owner 是 `data/databases/chatgtpQaEntries.json`，Turtle Soup 的唯一运行时数据 owner 是 `data/databases/turtleSoupPuzzles.json`。旧的 `seed-records-chatgtp.json` 和 `turtle-soup-puzzles.json` 重复副本不再注册；运行时窗口和确定性探针必须直接使用 canonical database。

## 目录索引

```text
index.html                 游戏项目入口；通过 #data-location 指定 data/
engine/index.html          独立引擎示例；通过 #data-location 指定 example.data/
engine/core/entrypoint.js  自动加载入口，读取数据目录并启动引擎
engine/core/               融合引擎 core：宿主运行时、Activity、窗口、变量、存档
engine/dev/                开发人员模式、数据库编辑器和存档/运行时调试器
engine/probes/             core-only 确定性探针，不属于玩家运行时
engine/example.data/       最小示例游戏内容包
engine/publish.js          发布与发布验证脚本
../data/                   主项目的 canonical framework/game 数据
```

两个 HTML 入口都只有引擎启动脚本和数据位置声明。根目录的 `#data-location` 相对根 HTML 解析；独立示例的 `#data-location` 相对 `engine/index.html` 解析。静态资源解析与开发服务器写盘也使用所选数据根。

开发模式启动会从内容根读取 `data-files.json`，供 JSON 数据编辑器与 Activity 编辑器发现可编辑源文件。每个启用开发模式的内容包都必须提供该清单，并确保 `files` 中列出的相对路径均存在；独立示例包也遵守此约定。

当前 manifest 的主要连接关系：`game-manifest.json` → `framework-manifest.json`、`activity-manifest.json`、窗口 manifest、数据库、公共变量、本地变量和 Activity 列表。默认 Activity 是 `default`，队列定义包含 `work`、`social`、`managers`、`main` 以及窗口/Widget/桌面事件队列。

虚拟文件系统由 `core/VirtualFileSystem.js` 持有，初始树位于 `data/virtual-filesystem.json`，程序定义位于 `data/app-definitions.json`。桌面 `/home/desktop`、开始菜单 `/home/menu`、程序 `/opt`、垃圾桶 `/trash`、命令 `/usr/bin` 是初始目录；无扩展名程序文件内容仅为稳定程序 ID，`.lnk` 内容仅为目标路径，图标由 `AppProgramRegistry` 解析。玩家文件树、内容和摆放位置由 SaveManager v9 存档。开发人员模式程序不属于任何 `data/` 文件：core 仅在精确 `?dev` 启动时注册程序并将带 `metadata.coreOnly` 的程序文件直接注入 `/home/desktop/开发人员模式`，不经过 `/opt` 或快捷方式；core-owned 文件只能由 core 注入，允许用户保存其桌面位置。应用定义校验拒绝 `dev-*` 程序 ID/目标，`dev/InitialVirtualFileSystemEditorView.js` 专门编辑 `data/virtual-filesystem.json`，组合运行时复用的文件管理器与文档编辑器，支持创建文件/文件夹、编辑文件、复制与粘贴快捷方式，并区分保存到内存、下载和写入磁盘；保存前执行默认 VFS schema 校验。桌面图标编辑器和开始菜单编辑器不再单独注册，`/home/desktop` 与 `/home/menu` 的初始条目都由该 canonical 文件树管理。存档调试器只处理运行时存档。普通模式恢复时过滤 core-only 文件、指向它们的快捷方式和 `dev-*` 窗口；开发模式恢复会保留当前 core 注册的条目及其保存位置，不接受存档伪造的未知 core-only 条目。`VirtualFileWidgets.js` 提供通用文件管理器、文档/选择器和 CMD 外观的 POSIX shell 终端；终端内容保持 `/cwd>` 提示符和 POSIX 路径，shell 通过内建 `cd`、`pwd`、`which`、`export` 与 VFS 中的外部命令运行；`/usr/bin` 中保留 `ls`、`sh` 及文件操作命令，不放置 `cd`、`pwd` 这类 shell 内建命令，默认 `PATH=/usr/bin:/opt`，支持通过 `/opt/<program>` 或 PATH 名称启动程序。`sh` 自身是 `/usr/bin/sh` 中的外部命令，支持嵌套 shell、`sh -c` 和 VFS 脚本运行（`sh /path/to/script.sh`）。终端通过 VFS 中的外部命令文件启动注册程序；`cat`、`cp`、`ls`、`mv`、`touch` 各自映射到 `system:<command>` CL2 Activity。`.txt` 打开文档，`.lnk` 先解析目标再分派，`.sh` 在终端运行；带 shebang 的任意文件由 shebang 指定的解释器应用执行，`/usr/bin/env` 会在 PATH 中解析解释器；其他文件（包含无扩展名）把内容作为应用稳定 ID，未命中时交给 `defaultProgram`。蓝图 `virtualFileSystem` 节点调用读、写、列举、复制、移动、touch、mkdir、remove 及命令操作，`terminalOutput` 节点写入指定终端实例。Activity 实例的 `parameters` 数组随队列快照持久化；应用程序管理器编辑默认回退定义和所有窗口/Activity 应用的 JSON 启动参数；显式窗口调用参数覆盖窗口默认参数，Activity 配置参数与命令运行时参数按顺序传递。Activity 蓝图通过 `getParameter(id)`（0 起始索引）读取，创建/排队 Activity 的 `runActivity`、`insertActivity` 节点可传参数。`dev/AppProgramManagerView.js` 负责应用程序定义编辑。`probes/virtual-filesystem-probe.mjs`、`probes/save-manager-probe.mjs`、`probes/virtual-terminal-probe.mjs`、`probes/virtual-file-ui-probe.mjs`、`probes/initial-virtual-filesystem-editor-probe.mjs` 和 `probes/activity-parameters-probe.mjs` 分别覆盖 VFS/core 注入、存档模式隔离与 Activity 参数恢复、POSIX shell/启动命令、桌面与文档 UI、初始 VFS 文件/文档编辑及存储，以及 Activity 参数编辑、传递和恢复契约。

虚拟文件与程序行为探针 `probes/virtual-file-command-activity-probe.mjs` 覆盖 `.sh` 图标分类、未知程序默认应用定义、快捷方式解析、可参数化窗口以及五个 CL2 文件命令和终端输出节点；shebang 解释和 shell 到注册 Activity 的参数/CWD 转发由 `probes/virtual-terminal-probe.mjs` 检查。应用程序管理器的窗口参数、默认应用编辑和窗口调用覆盖规则由 `probes/activity-parameters-probe.mjs` 检查。

CL2（Cultists Blueprint & Script Language 2）是当前 Activity 的生产脚本图格式。`core/Cl2Parser.js`、`core/Cl2Validator.js` 和 `core/Cl2Serializer.js` 提供统一解析、验证和编辑器回写；`core/Cl2Compiler.js` 与 `core/Cl2CodeGenerator.js` 在定义加载时把已验证的图编译成节点专门化 JavaScript：每个流程节点直接包含其操作，静态流程边降低为数字程序计数器目标，纯值依赖生成 JavaScript 表达式，并在编译期折叠常量算术和可静态判定的分支。生成执行器不再调用 `hooks.executeNode`，Activity 热路径也不递归调用 `resolveInput`/`evaluateValueOutput`；`evaluateValueOutput` 仅供 Activity 外的可用性等消费者使用。数字 PC 状态机仍负责支持循环、等待、断点和恢复；生命周期回调维护 trace/checkpoint，宿主副作用仍经过通用能力网关。编译器还为 `blockUntil` 生成公共变量、通用变量和时钟依赖；运行时只对可识别的相关事件重评等待条件，动态/未知依赖仍保守监听，等待代次可丢弃已失效的事件快照回调。队列实例在每个节点后同步更新，但纯同步节点不逐步广播 `activity:changed`；等待、断点、终止和显式生命周期操作仍通知订阅者。`WindowFrame` 将变量、时钟、Activity 和运行时集合失效请求合并到下一浏览器帧，每帧最多重建一次 widget 根节点，并丢弃窗口销毁后的待执行刷新，避免长 Activity 循环重复同步重绘所有窗口 DOM。`ActivityQueue` 同时保留有序实例数组与 `instanceId` 索引 Map，逐节点检查点通过索引更新，避免队列越长每步扫描开销越大。`ActivityRunner` 以实例内 Set 索引已执行节点与断点，避免每个节点都扫描随 Activity 增长的存档数组；`activity-execution-id-index-probe` 验证了长流程执行不再逐节点线性检查。编译结果保留 `debugInfo.nodeIds`、节点到生成源码行/端口/流程目标的 `sourceMap`、生成源码和优化计数；Activity Runner 的 `getDebugState()` 暴露当前步骤、等待状态、已执行节点和实例本地变量。开发人员模式可选择可执行流程步骤、设置节点断点、检查进度与变量并展开查看本次生成源码；编译/调试元数据只在内存中，而实例的 `executionStep`、`executionTrace`、断点列表/暂停节点、当前节点和已执行节点随 Activity 队列存档。存档版本 v8 开始持久化这些进度字段；恢复后重新挂接暂停 runner，继续时越过当前断点一次后执行，不重复已完成副作用。`data/activity-manifest.json` 的 Activity 均指向 `.CL2.txt`；旧 JSON 仅保留为迁移审计输入。

`Cl2Compiler` 生成 source map 行号时按代码块增量累计换行数，避免对每个节点反复切片、扫描不断增长的源码前缀。`probes/cl2-source-map-performance-probe.mjs` 覆盖源码行映射正确性，并测量大型合成 Activity 的编译开销。

队列投影与数据库 join 在每次集合读取中只查询一次数据库，并用当前读取范围内的 Map 匹配队列项；这样保持原有首次匹配、顺序和字段覆盖语义，同时避免每个队列项重复克隆整库记录。索引不跨读取缓存，确保数据库修改会立刻反映在后续投影中。`probes/runtime-collection-join-performance-probe.mjs` 用 canonical HIS 患者数据覆盖查询次数、队列过滤/排序、重复 join key 与读取间更新。

CL2 也覆盖窗口事件、物品活动和自定义蓝图节点中的内嵌流程图：这些 JSON 内容使用 `{ "cl2": "..." }` 保存，`DataLoader` 在运行时解码为图，开发数据编辑器保存时重新编码为 CL2。

内嵌 CL2 的对象/数组值会递归解析 reusable 和 node 引用；自定义流程节点没有名为 `flowOut` 的输出时，隐式 `default` 连接到其首个声明出口。`framework:consumeTime` 的宏图直接调用 core `consumeTime` 节点，不依赖未注册的领域 API。显示节点保留 `text(displayTo, speaker, text, ...)` 的 canonical 参数顺序；动态窗口组件复制时合并模板事件，不能覆盖原有交互事件。
设置窗口已迁移到 `data/windows/settings.json`，由桌面图标 `settings` 打开；四项设置分别绑定 `settings:bgmVolume`、`settings:notebookSortMode`、`settings:confirmPhaseChange` 和 core 语言节点。该窗口不新增业务 JavaScript。

BGM 已按三层接入：`data/bgm.json` 保存旧引擎迁移的曲目与 schedule 规则，`data/structures.framework.json` 声明 `bgmTrack`/`bgmRule` 自定义结构；core 的 `playBgm`、`stopBgm`、`setBgmVolume`、`pushBgmLayer`、`restoreBgmLayer` 节点只调用通用音频宿主 API；framework 的 `data/activities/bgm-manager.CL2.txt` 是 CL2 管理器。旧工程目录中没有音频二进制文件，因此当前只迁移了配置与控制层，音频素材仍需外部补齐。

位置场景窗口 `data/windows/location-scene.json` 现在从 `locations` canonical database 读取当前地点的 `name`、`backgroundImage` 和 `subLocations`，以通用 list Widget 显示可调查区域；医院、火锅店和海边没有子区域时列表保持为空，不伪造交互状态。

## 本地运行

只读静态服务器：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

开发服务器（开发模式下提供受限的 canonical 数据读写 API）：

```bash
node engine/dev-server.js
node engine/dev-server.js --port 8001 --lang zh-hans
```

打开 `http://127.0.0.1:8000/`；开发工具入口只使用 `http://127.0.0.1:8000/?dev`。开发服务器仅绑定本机，写盘前仍须经过编辑器 schema 校验。静态文件路径会先解码 URL 百分号编码，以支持中文 Activity 文件名。不要把开发服务器暴露到公共网络。

## 运行时职责

| 层/模块 | 职责 |
| --- | --- |
| `engine/core/entrypoint.js`、`engine/core/engine-bootstrap.js` | 从当前 HTML 的 `#data-location` 读取数据根，加载 manifest，组装 Cultists 引擎 core 能力并启动平台 |
| `ActivityDefinitionStore`、`ActivityRunner`、`ActivityQueue*` | 加载、排队、执行和恢复 Activity |
| framework 的时间/状态 Activity 与数据 | 工作时间、`phase`、`duty`、`location`、时间推进、上下班/睡眠边界和工作状态机 |
| `GameClock` 等 core 基础设施 | 提供与具体工作语义无关的确定性时钟和状态存储能力 |
| `WindowManager`、`WindowDefinitionStore`、桌面模块 | 桌面、窗口、Widget 和布局 |
| `DataStore`、`DataStructureManager`、`PublicVariableManager`、`LocalVariableManager` | canonical 数据、结构定义、公共变量定义和 Activity 本地变量命名定义；本地值属于实例 |
| `SaveManager`、`VariableStore`、`EventStateRegistry` | 存档、运行时变量、事件状态和恢复 |
| `VirtualFileSystem`、`AppProgramRegistry`、`DesktopIconManager` | VFS 文件树、程序 ID/图标解析和快捷方式投影；core-only 条目仅由 core 注入 |
| `VirtualFileWidgets` | 通用文件管理器、文档/文件选择器、终端及文件操作界面 |
| `VirtualFileSystemCapabilities`、`virtualFileSystem`/`terminalOutput` CL2 节点 | 经 API gateway 提供通用 VFS 操作与目标终端输出 |
| `AppProgramRegistry`、`AppProgramManagerView` | 应用定义、默认回退程序、窗口/Activity 参数和目标校验 |
| `data/activities/*.CL2.txt`、`data/windows/`、`data/databases/` | CL2 Activity、窗口定义和游戏数据库；窗口事件、物品活动和自定义节点内嵌图使用 `{ "cl2": "..." }` |
- `dev/`、`dev-server.js` | 开发编辑器、调试器和本地数据写盘 |
- `core/i18n/`、`dev/I18nManagerView.js` | Core 与开发人员模式 locale modules、统一 `t()` 取词、语言状态和开发人员语言管理器 |

业务行为应进入 Activity 蓝图和数据，不应在窗口或入口脚本中新增业务副作用。需要原生能力时，按 `game → framework → core` 方向抽象为通用能力。

## 状态与内容约定

- framework 默认状态：第 1 天 `08:00`，`phase=day`、`duty=on-duty`、`location=work`。
- framework 工作窗口是 `[08:00, 16:00)`；普通成功行动默认消耗 20 分钟；游戏时间不依赖系统时钟。工作状态机及上述字段的语义由 framework 负责，core 不包含这些游戏/工作领域语义。
- 玩家可见计时和持久化副作用通过 Activity 执行。工作、社交、管理器和主队列由 manifest 配置，不能在入口中按业务语义偷偷插入 Activity。
- 游戏内容使用稳定 ID。窗口、Activity、数据库、公共变量和资源之间通过 manifest/schema 连接。
- 公共变量、数据库、窗口、Activity 和存档各有边界；数据库编辑器写 canonical 数据，存档调试器只改运行时存档。
- VFS 初始树是 canonical game 数据，用户文件、目录和位置属于 VFS 存档；开发人员模式程序只由 core 在精确 `?dev` 启动时作为 core-only 文件直接注入桌面，不能写入任何 data 文件，也不经过 `/opt` 或快捷方式。普通模式恢复会剔除 core-only 条目。
- 运行时集合可在数据定义中声明 `stateAliases`，用于旧稳定 ID 到 canonical ID 的恢复兼容；同一存档同时存在两者时 canonical ID 优先。
- 运行时集合可声明 `activityQueueId` 和 `projectPayload`，以通用方式把 Activity 队列投影为 CL2 列表；队列追加/变更会发出 `runtime:collection-changed`，窗口可据此刷新，core 不解释 payload 的业务语义。患者列表使用 framework 声明的未解决 work 队列投影并通过稳定的 dialogue Activity ID 关联患者数据库；室友/社交联系人列表同样从未解决 social 队列派生，不能静态读取全量数据库。
- 运行时集合支持数据声明的派生字段、跨数据库 lookup、前置占位记录和 `stateCollectionId`；ChatGTP 关键词窗口按来源、类别、关键词三行筛选并复用 `notebookKeywords` 的 canonical 收集状态，空类别值表示跳过类别过滤。
- Activity 的 `text`/`choice` 显示事件会保留在实例 transcript 中；`engine.activity.replay` 只回放已保存文本并先发送 `display:reset`，不会重新运行 Activity 节点；回放同时经过 DisplayReceiverRegistry 和 event bus，避免已打开的对话窗口只显示空容器。开发 Activity 调试器通过正常 `runActivity` API 触发结局 Activity，不直接修改队列内部状态；社交媒体窗口的尺寸与标签栏遵循 main 分支旧应用的布局契约。
- 本地变量管理器写 `data/local-variables.framework.json` 的定义，不保存实例值；活动调试器才允许实时修改具体实例的 `localVariables`。
- 详细 schema 以实际 `data/*.json` 和对应 loader/validator 为准；修改 schema 时必须同步编辑器、运行器、调试器和探针。
- Core 自有字符串放在 `core/i18n/xx-xx.js` locale 模块中；`I18nManager` 管理当前/启用语言并纳入存档，Activity 可通过 `getLanguage` 与 `setLanguage` 节点访问。
- core 与 dev 的用户可见字符串通过 `core/i18n/index.js` 的 `t()` 访问；协议 ID、事件名、CSS 类名、节点类型和数据字段名保持稳定，不作为翻译文本。

## 常用验证

项目没有统一测试框架，通常按改动范围选择：

```bash
# JavaScript 语法
for f in $(git ls-files '*.js'); do node --check "$f"; done

# JIT 直接代码生成与热路径基准
node engine/probes/cl2-jit-direct-codegen-probe.mjs
node engine/probes/cl2-jit-performance-probe.mjs
node engine/probes/cl2-source-map-performance-probe.mjs
node engine/probes/activity-checkpoint-coalescing-probe.mjs
node engine/probes/window-frame-refresh-coalescing-probe.mjs
node engine/probes/activity-queue-index-probe.mjs
node engine/probes/activity-queue-checkpoint-performance-probe.mjs
node engine/probes/activity-execution-id-index-probe.mjs
node engine/probes/public-variable-probe.mjs
node engine/probes/runtime-collection-join-performance-probe.mjs

# JSON 全量校验
python3 -c 'import json, pathlib; [json.load(open(p, encoding="utf-8")) for p in pathlib.Path(".").rglob("*.json") if ".git" not in p.parts and "publish" not in p.parts]'

# 空白与发布
git diff --check
node engine/verify-publish.js
```

针对当前 core/framework/game 状态或 Activity，优先运行对应的 `engine/probes/*.mjs`；旧版迁移、legacy reference 和一次性内容盘点探针已删除。浏览器交互验证只有实际启动并操作页面后才能报告为通过。

## 文档同步要求

任何 agent 修改代码、数据 schema、引擎分层、开发命令、版权边界或发布行为后，必须在同一任务中检查并更新以下三份文档：

- `AGENTS.md`：更新必须遵守的规则和架构约束
- `docs/agent-notes.md`：更新实现索引、命令和维护补充信息
- `README.md`：更新面向人类读者的项目描述和使用方式

完成修改前应搜索三份文档中的旧名称、旧路径、旧层职责和旧许可证，避免只更新一份文档造成互相矛盾。

文档归属判断：只有所有后续任务都必须遵守的稳定约束才进入 `AGENTS.md`；项目背景、实现索引、过程说明和可变信息进入本文件；面向人类的使用说明进入 `README.md`。

## 发布与版权

`engine/publish.js` 生成玩家版 `publish/`，排除引擎开发工具、探针、独立示例包和文档，并移除 `DEV-TOOLS` 区块；发布验证统一使用 `node engine/verify-publish.js`，验证完成后自动删除 `publish/`。Cultists 引擎遵循 [`copying.txt`](../copying.txt) 的 BSD 2-Clause License；`game` 层游戏内容保留版权，除非内容文件另有声明，不得擅自再分发。外部素材和字体仍需分别确认许可证、保留来源和版权信息。项目不使用未经确认可商业使用的版权字体。

## 相关文件

- [`AGENTS.md`](../AGENTS.md)：代理必须遵守的架构、版权、字体、修改和验证规则。
- [`README.md`](../README.md)：面向玩家、贡献者和普通读者的项目介绍。
- [`cl2-language.md`](cl2-language.md)：CL2 统一脚本图语言设计草案。
- [`skills/cl2-script-authoring/SKILL.md`](skills/cl2-script-authoring/SKILL.md)：面向 Agent 的 CL2 脚本编写、迁移和验证流程。
- `data/game-manifest.json`：当前内容包入口和初始状态。
- `data/framework-manifest.json`：framework 文档与通用运行时连接。
- `data/activity-manifest.json`：Activity ID 到蓝图文件的清单。
- `publish.js`：玩家版发布脚本。

## ChatGTP、下班电脑与结局显示

- ChatGTP 答案中的 `[[keywordId|显示文本]]` 由通用 Widget renderer 渲染为可点击关键词；收集动作同时写入 `keywords` 与 `notebookKeywords`，因此疾病关键词也能进入笔记本。
- `ending-screen` 使用独立的 `fullscreen` 数据窗口承载全屏媒体、对话面板、主控与说话角色立绘；结局 Activity 的首条文本到达前会先挂载显示目标窗口，避免首句文本和立绘因接收器尚未注册而丢失。下班模式同样使用 `off-duty.json` 的普通全屏窗口；两者隐藏边框和标题栏。全屏窗口打开期间由 Shell 隐藏任务栏；全屏窗口本身不使用特殊 z-index，后续聚焦的普通对话窗口可以覆盖它。
- `?dev` 会自动打开开发人员模式窗口；该窗口声明 `alwaysOnTop`，普通游戏窗口不能覆盖它。
- 对话联系人列表的显示 ID 与回放实例 ID 分离：窗口列表通过 `itemEventValueField: "queueInstanceId"` 回放 Activity 队列实例；普通对话保留 transcript，`ending-screen` 只保留当前一句并由继续按钮推进下一句。结局立绘使用统一容器尺寸和资源路径解析，玩家资源的透明留白需通过显示缩放归一化。
- `dorm-bottom` 室友对话显示会路由到 `ending-screen`，对话窗口关闭；Activity 完成后由结局窗口自己的“继续”按钮关闭会话。`ending-screen` 声明 `dorm-bottom` 接收别名以接收 Activity 完成和 reset 事件。
- Activity 编辑器工具栏提供“CL2 脚本编辑器/蓝图编辑器”切换；图形模式导出当前草稿为 CL2，源码模式切回图形模式前执行解析和完整验证，失败时保留源码和原图形草稿。
- Activity 编辑器的“查看 JIT JavaScript”入口紧邻 CL2 切换按钮；每次点击都从当前图形草稿或 CL2 文本重新调用 `compileCl2Activity`，只读显示本次生成源码，编译失败会清空旧输出并显示错误。纯数值组件蓝图不提供此 Activity 编译入口。
- 启动时 `gameTimeMinutes` 公共变量在注册 `GameClock` 同步源后立即同步；否则患者队列管理器在第 1 天 08:00 会读取默认零值并停在首个 `blockUntil`，HIS 的 `hisPatients` 集合为空。
- 窗口组件数值蓝图会为绑定到组件属性的每个图输出生成无输出的 `valueReceiver` 终端；CL2 `inputvalue` 在源码/图形往返时保留接收节点及全部数值边，运行时由接收节点读取其输入值。`reusablevalue`、`inputvalue` 和流程声明均写入并读取 `@cl2.pos`；旧源码缺少坐标时，ActivityEditorModel 在加载时补齐，以免 SVG 连线路径因 `undefined` 坐标变为 `NaN`。旧式 `inputvalue receiver: arithmetic[...]` 会归一为纯值表达式加接收包装节点。
- Activity 蓝图节点样式依类别区分：流程节点蓝色、流程起点蓝色并显示 Home 图标、纯值节点绿色、数值接收节点紫色。
- `blockUntil(condition)` 的单参数布尔 CL2 形式固定绑定 `condition`，不能落到兼容性的 `equals` 输入；这保证启动患者队列管理器在 08:00 立即插入首批患者。纯数值编辑器使用独立验证，不要求流程起点和终点。
- 普通 `dialogue` 窗口的主接收目标是 `his-app`，只保留 `default` 别名且不创建结局立绘占位 DOM；`dorm-bottom` 由引擎路由到全屏 `ending-screen`，避免室友对白同时落入普通对话框。
- 开发人员模式的窗口调试器位于下方运行时调试器区域，与 Activity、存档、公共变量和时间调试器并列；窗口定义编辑器仍位于上方数据编辑区域。所有子应用在启动器、窗口标题栏和任务栏使用彩色 Emoji 图标。
- 下班模式的交流按钮和室友条目已移除普通 `dialogue` 窗口打开节点，直接运行 Activity；首条 `dorm-bottom` 显示事件负责打开结局窗口，避免出现空的对话框。
- 社交 Activity 的 `activityExpiry[true, 2880]` 表示启用第 2 天绝对过期边界，不表示当前已过期；可用性判断已改为只在启用标志为 true 时比较 `expiresAt`，修复点击交流无反应。
- 旧社交 CL2 对白常省略 `continueKey`；ActivityRunner 对 `dorm-bottom` 自动生成 `dlg:<nodeId>:continue`，让结局窗口显示继续按钮并在点击后推进到下一句，最终完成事件再显示关闭会话按钮。
- 社交分支 Activity 的 CL2 `choice` 节点已补回选项标签和 `dlg:<nodeId>:select` 选择键；运行时会渲染选项按钮并把索引写回 Activity 等待变量。
- `ActivityRunner` 恢复等待中的文本节点时会先消费已设置的 continue key，再跳转下一节点；这避免重复显示上一句并确保下一节点的选项分支能够派发。
- 社交 Activity 的 choice 通常未声明 `displayTo`；运行时现在继承上一条对白的 `dorm-bottom` 接收目标，确保结局窗口收到并替换继续按钮为选项按钮。
- 选项点击唤醒 Activity 时，ActivityRunner 先消费已有选择并直接跳转 `option<n>`；不会重复发送相同 choice 事件造成界面看似无反应。

## 独立引擎示例包：VFS、物品与新手引导

`engine/index.html` 加载 `engine/example.data/`，用于独立演示 core 的 VFS、应用程序管理器、窗口与数据系统。桌面和开始菜单通过 `.lnk` 指向 `file-manager`、`document`、`terminal` 三个 `AppProgramRegistry` 程序；窗口定义在 `example.data/windows/`，全部登记于 `game-manifest.json`，可通过双击桌面入口启动。文件浏览器、文档编辑器与终端共享同一个虚拟文件系统。示例终端的 `cp`、`mv` 注册为 `system:cp`/`system:mv` CL2 Activity，`rm` 继续复用共享 VFS shell 命令路径；`probes/example-terminal-probe.mjs` 检查 Activity 参数/CWD 转发、文件操作结果及删除进垃圾桶的行为。

示例物品由 `item-records.json` 提供，`structures.json` 和 `databases.json` 声明结构与数据库。`framework-runtime.json` 将库存及使用计数声明为运行时集合，并把集合快照同步到公共变量 #12；公共变量 #10/#11 分别记录金钱与成功使用次数。`blueprint-nodes.json` 定义示例层自定义 CL2 宏：启动时从数据库读取初始库存，调查物品时选择 canonical 记录并更新调查面板，使用物品时仅在库存扣除成功后推进时间、加钱和计数。`onboarding.json` 声明事件驱动提示，core bootstrap 按 `tutorialOverlay` 配置挂载通用 TutorialOverlay。

`probes/example-demo-runtime-probe.mjs` 覆盖示例包文件清单、三个应用启动映射、CL2 注册与宏执行、数据库/运行时集合/公共变量同步、成功和库存不足分支的时间与奖励副作用，以及引导 milestone。此探针是确定性运行时证据；浏览器交互仍须单独操作验证。

自定义窗口编辑器复用 `core/WidgetLayoutRenderer.js` 的运行时布局契约。list 的 `items` 仍可在主检查器中绑定到变量或窗口 valueGraph，模板属性改由右侧检查器打开独立子窗口编辑，故蓝图可提供清单内容而不覆盖显示模板；普通 tabs 与 recordTabs 也在子窗口中管理选项卡和字段映射，recordTabs 的 `items` 支持蓝图绑定。普通 tabs 由 renderer 输出可切换的 tablist 和内容面板。拖放进入 stack 布局时先把现有子项屏幕几何转换为容器本地 `x`/`y`，单次拖动记录为一个历史事务；`probes/window-editor-subeditor-probe.mjs` 覆盖子编辑器表单、绑定、选项卡增删、主窗口草稿写回和 renderer 切换，`probes/window-editor-template-probe.mjs`、`probes/window-editor-drag-probe.mjs` 和 `probes/example-terminal-probe.mjs` 分别覆盖模板/绑定、拖放布局和示例命令。DOM mock 探针不是人工浏览器验收；本轮另以临时同源 harness 在 Hermes 内置预览执行了 23 项真实 DOM 合成事件断言（未做人工鼠标或像素验收）。

蓝图节点管理器为自定义 Activity 节点提供“编辑蓝图”入口；Activity 编辑器保存时由管理器回调更新节点注册表，canonical JSON 持久化仍由管理器的“写入磁盘”操作显式执行。`probes/blueprint-node-manager-probe.mjs` 覆盖使用物品与调查物品的编辑保存路径，临时内置预览 harness 还打开共享 Activity 编辑器并验证了这两个节点的保存回写。浏览器测试仅验证合成 DOM 事件路径，没有人工鼠标验收。
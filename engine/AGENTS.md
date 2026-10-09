# AGENTS.md

本文件是项目的编码代理合同，只记录必须遵守的规则。项目背景、目录索引、开发命令和实现说明见 [`agent-notes.md`](docs/agent-notes.md)；面向人类读者的项目介绍见 [`README.md`](README.md)。本项目主要协助 **Cultists 引擎**（`core` 与 `framework`）开发，以及将 `game` 层内容适配、迁移到新引擎。

## 基本规则

- 所有文本文件使用 LF 换行。
- 使用原生 HTML、CSS 和 ES modules；除非任务明确需要，不引入框架、构建步骤或第三方依赖。
- 不提交、打印或读取凭据、令牌和 `.env` 文件；发现敏感内容时以 `[REDACTED]` 表示。
- 修改前读取相关代码、数据 schema、调用点和现有文档，不凭文件名猜接口。
- 数据驱动的内容使用稳定 ID；持久化数据不得使用显示名称、翻译文本或语言目录作为 ID。
- UI 外壳字符串使用现有国际化机制；剧情、角色和其他游戏内容放在数据文件中。
- 保持现有目录和模块边界；无关重构、顺手格式化和兼容层回填都不属于默认范围。

## 融合引擎三层架构

旧引擎和 NG 引擎已经合并为当前唯一的 **Cultists 引擎**。`core`、`framework`、`game` 是同一引擎中的三层，不是两套并行运行时。日常开发重点是 Cultists 引擎本身（`core`、`framework`）和 `game` 内容迁移/适配。

### `core`

- `core` 是唯一允许使用原生 JavaScript 实现的平台层。
- 只提供与具体游戏无关的宿主能力：桌面与窗口运行时、Activity/CL2 执行与调度、节点/端口/连线校验、数据加载、通用变量与存档基础设施、事件总线、通用 Widget/DOM 能力、输入输出和受控能力网关，以及开发模式的宿主入口。
- 新手引导的视觉提示层可以作为通用 core overlay，但只在内容 manifest 显式启用时挂载；提示与 milestone 定义、事件映射及持久化状态由内容数据和通用事件状态注册表提供，overlay 不得改写游戏状态、队列或时间。
- 不得包含患者、物品、日历、宿舍、NPC、成就、结局、剧情或具体应用语义。
- 工作时间、`phase`、`duty`、`location`、上下班/睡眠边界和工作状态机不属于 core；它们必须由 framework 通过 CL2 与数据实现。core 只提供可复用的时钟、状态存储、Activity 和能力网关。
- 新增能力必须说明 owner、输入输出契约、权限与副作用、snapshot/restore（如需持久化）和确定性探针；上层只能通过公开的通用 API 或 CL2 节点使用它。
- core 自有 UI/错误字符串必须存放在 `core/i18n/xx-xx.js` locale 模块；语言状态由 core 的 i18n 管理器拥有，使用 `getLanguage` 数值节点读取、`setLanguage` 流程节点设置，并通过 snapshot/restore 持久化。
- core 与开发人员模式中的用户可见文本必须通过 `core/i18n/index.js` 的 `t()` 读取；locale 模块是字符串的唯一存储位置。协议 ID、CSS 类名、事件名、节点类型和数据字段名不翻译。

### `framework`

- `framework` 实现可复用的预制系统和通用 UI 行为，必须使用 CL2 蓝图及数据文件，不得新增业务 JavaScript。工作时间、`phase`、`duty`、`location`、上下班/睡眠边界、工作状态机和通用时间规则都属于 framework。
- BGM 的策略管理归 framework：`data/activities/bgm-manager.framework.json` 是 CL2 管理器，通过 core API/CL2 节点控制播放；BGM 曲目和规则属于 game 的自定义数据结构，不得把具体曲目 ID 写进 core。
- 需要宿主能力时，先在 `core` 增加领域无关的能力，再通过类型安全的 CL2 节点调用；禁止为单个业务添加原生 JavaScript 快捷入口。
- framework 不得依赖 game，也不得把具体游戏概念写进 core。

### `game`

- `game` 实现本项目的医疗、患者、宿舍、日历、社交、物品、成就、结局、应用、剧情和业务 Activity，必须使用 CL2 蓝图及数据文件。
- game 的 BGM 配置位于 `data/bgm.json`；音频 `src` 使用稳定曲目 ID 关联，素材缺失时必须如实报告，不得用占位资源冒充迁移完成。
- 不得在 game 中新增原生 JavaScript 业务模块、业务管理器或绕过 Activity 执行系统的副作用。
- 业务数据、蓝图定义、窗口定义和能力注册通过稳定 ID 与明确 schema 连接。

依赖方向只能是 `game → framework → core`。`core` 不得依赖上层，`framework` 不得依赖 game。Cultists 引擎入口只负责启动 core、加载 framework/game 内容清单并把默认 Activity 放入默认队列；后续业务调度必须由已运行的管理器 Activity 通过 CL2 Activity API 显式完成。

## CL2 与运行时约束

- 蓝图语言统一称为 **CL2（Cultists Blueprint & Script Language 2）**。编辑器、schema 校验器、运行器、调试器和数据迁移工具必须遵守同一节点、端口、连线、局部变量和公共变量契约；Activity canonical 文件使用 `.CL2.txt`。
- 本地变量管理器只登记本地变量的稳定 ID、名称和类型；变量值必须保存在单个 Activity 实例的 `localVariables` 中，不得通过管理器或公共变量跨实例共享。
- Activity 是玩家可见计时和可持久化副作用的统一入口；窗口/App 负责发起请求和显示结果，不直接修改游戏状态或推进游戏时间。
- 游戏时间必须是确定性的游戏状态，不使用真实系统时间、`Date`、`getHours()` 或计时器控制游戏时间。
- framework 的默认游戏状态为第 1 天 `08:00`、`phase=day`、`duty=on-duty`、`location=work`；工作窗口为 `[08:00, 16:00)`。`phase`、`duty`、`location` 是 framework 的独立字段，恢复存档时必须保持一致。
- 普通成功行动默认推进 20 分钟；长时间成本按现有 Activity/NGL 约定拆分，不在 UI 层偷偷推进时间。
- 存档恢复、跨日、睡眠、医疗、收入支出、队列和动态 Activity 的所有状态变化必须有明确 owner 和恢复顺序。
- Activity 队列保留有序 `entries`，并维护按稳定 `instanceId` 索引的 Map；append/remove/restore 必须同步该索引，运行时逐节点 get/update 不得线性扫描整个队列。
- 运行时集合定义可声明 `stateAliases`，由通用恢复流程把旧稳定 ID 归一到 canonical ID；core 不得写入具体游戏 ID，冲突时 canonical 记录优先。
- 运行时集合可通过声明式 `derivedFields`、数据库 lookup、`prepend` 和 `stateCollectionId` 生成筛选字段、占位选项并复用 canonical 收集状态；窗口筛选应使用稳定 ID 和通用集合过滤，不在 renderer 或业务 JavaScript 中硬编码来源/类别判断。
- 运行时集合还可通过通用 `activityQueueId` 投影 Activity 队列；core 只负责队列记录和可选 payload 投影，具体联系人/业务字段必须由 framework/game 数据声明，队列变化通过 `runtime:collection-changed` 驱动窗口刷新。
- Activity 队列与数据库连接的运行时集合每次投影只查询数据库一次，并构建仅限本次读取的 join 索引；必须保留队列顺序、重复 join key 的首个记录匹配和既有字段合并语义，不能逐条重扫数据库或跨读取缓存实体。
- Activity 的对话 transcript 可随实例保存，并通过通用回放能力向声明的 display receiver 重放；回放只能发送已保存的显示事件，不得重新执行蓝图或产生时间、资源和剧情副作用。
- Activity 每个节点执行后都必须同步更新队列中的实例检查点；纯同步步骤不得逐节点广播 `activity:changed`，以免每一步触发所有数据窗口重建 DOM。窗口对变量、时钟和运行时集合失效事件必须按浏览器帧合并根节点重绘，并忽略已销毁窗口的排队刷新；等待、断点、终止及显式生命周期操作仍通知订阅者。
- 蓝图节点只能使用项目定义的合法端口组合；新增节点必须同时通过 schema 校验、运行时探针和相关编辑器验证。
- CL2 内嵌值绑定必须递归解析；自定义流程节点的隐式 `default` 必须映射到其声明的首个流程出口，framework 宏不得调用未注册的领域 API。
- 显示节点的 canonical `text` 调用使用 `displayTo, speaker, text, ...` 顺序；动态窗口组件复制必须合并模板事件，不能因生命周期事件覆盖 `onAdd`/`onRemove` 等交互蓝图。
- CL2（Cultists Blueprint & Script Language 2）统一脚本图语言规范见 [`cl2-language.md`](cl2-language.md)。Activity 运行时、定义存储和编辑器均使用 CL2；旧 JSON 仅作为迁移审计输入，不是生产 Activity source。CL2 采用显式节点 ID、`option<x>` 分支、`default` 默认出口、纯值函数和 `if` 回边。
- Activity 定义加载时必须先校验 CL2，再将流程节点操作、静态流程目标和纯值表达式专门编译为 JavaScript；必须在编译期折叠可判定常量，不得把通用 `executeNode`/递归值解析器包进生成函数冒充 JIT。通用生命周期回调可保留等待、检查点和恢复语义，所有宿主副作用仍通过 core 能力网关执行。生成源码中的稳定 ID 与数据字面量必须安全转义；编译结果须保留稳定步骤 ID、源码映射和生成源码供开发人员模式调试，不写入存档。
- `blockUntil` 等待必须只订阅其可静态识别的变量/公共变量/时钟依赖；遇到动态或未知依赖时保守订阅通用唤醒事件，并用等待代次屏蔽已失效订阅的快照回调，避免无关变量更新导致重复重评。
- JIT source map 的源码行号必须随生成过程线性累计；不得为每个节点重复扫描生成源码前缀。
- Activity 实例的当前节点、执行步骤/trace、已执行节点、等待位置和断点必须随队列存档；断点使用稳定节点 ID，恢复时先重建 runner 并停在断点，显式继续后跳过该断点一次再执行，禁止在恢复过程中重放已完成副作用。Runner 对已执行节点和断点的热路径成员检查必须使用实例内索引，不能逐节点扫描存档数组。


## 数据、版权和字体

- Cultists 引擎（`core` 与 `framework`）使用根目录 [`copying.txt`](copying.txt) 中的 BSD 2-Clause License。新增或修改的引擎代码、引擎数据、文档和工具不得引入与该许可证冲突的内容。
- `game` 层的游戏内容保留版权，不因 Cultists 引擎使用 BSD 2-Clause License 而自动获得开源或再分发许可。除非内容文件另有明确声明，游戏剧情、角色、医疗内容、对话、图片、音频、视频、数据和其他内容资产均不得擅自复制、修改、再分发或用于其他项目。
- 外部代码、数据、图片、音频、视频和字体必须先确认许可证允许本项目用途，并保留来源、版权声明和许可证文本或链接；不能因为素材“免费”就默认可以商用或再分发。
- 字体只允许使用许可证明确允许商业使用和再分发的免费开源字体。新增字体必须记录来源、许可证和适用范围，并覆盖正文、标题、控件、伪元素、开发工具和发布版本；未经确认不得使用版权字体。
- 不把翻译文本、患者姓名或其他显示内容当作持久化标识。语言切换必须保持稳定 ID 和存档兼容。

## 开发工具与发布

- 开发人员模式、编辑器、调试器和本地写盘能力只能在开发环境使用；入口严格判断 `?dev`，不能把任意查询串视为开发模式。
- 开发人员模式入口由 core 直接注入为桌面 `/home/desktop/开发人员模式` 的 core-only 程序文件；不得安装到 `/opt` 或通过快捷方式间接暴露。
- 任何通过 `?dev` 启动的内容包都必须提供根级 `data-files.json`，其 `files` 列表只包含该包内存在的可编辑数据文件；内容包探针必须检查清单及其引用文件。
- 开发专用代码使用 `DEV-TOOLS:START` / `DEV-TOOLS:END` 标记（CSS/HTML 使用对应注释形式）。业务成就和业务数据不是开发人员模式内容，不能因发布清理而删除。
- canonical 数据编辑器必须校验 schema，并明确区分“保存到内存”“下载”和“写入磁盘”；存档调试器只能修改存档/运行时状态，不能把数据库内容写入存档调试器。
- 活动调试器必须订阅 Activity 生命周期事件实时刷新，并通过运行时 API 修改实例节点、状态、本地变量和队列，不得直接改写隐藏的 runner/Map。
- 活动调试器的“触发结局”入口必须筛选 canonical ending Activity 并调用公开的 `runActivity` API；不得直接改写隐藏队列或绕过 Activity 执行系统。对话 transcript 回放必须同时投递到 DisplayReceiverRegistry 与公开事件总线，确保已挂载窗口不会只出现空容器。社交媒体窗口如需保持旧版布局，应在窗口数据和通用 Widget/CSS 契约中声明 main 分支的尺寸、标签栏和滚动边界，不得新增业务 JavaScript。
- ChatGTP QA 和 Turtle Soup 的运行时 canonical owner 分别是 `data/databases/chatgtpQaEntries.json` 与 `data/databases/turtleSoupPuzzles.json`；不得重新注册已删除的 seed/native 重复副本。
- 发布版必须移除开发工具、编辑器、调试入口、本地写盘服务器、审计工具和确定性探针，同时保留运行时所需的 framework/game 数据与 core 能力。

## 修改与验证

- Activity 蓝图开发编辑器必须提供图形蓝图与 CL2 文本源码之间的显式切换；切换回图形模式前必须解析并验证 CL2，解析失败不得覆盖当前图形草稿。
- Activity 蓝图编辑器的 JIT JavaScript 查看入口必须紧邻 CL2 源码入口；每次打开都须从当前图形草稿或当前 CL2 文本重新编译，显示区只读，不得展示 ActivityDefinitionStore 的缓存编译结果。CL2 模式下先解析并验证当前文本；纯数值蓝图不提供 Activity JIT 查看入口。
- 依赖 `GameClock` 的公共变量同步源必须在注册后立即初始化同步，再订阅后续时钟变化；不能让启动 Activity 先看到默认零值而永久停在 `blockUntil`。
- CL2 `inputvalue` 必须解析为无输出的 `valueReceiver` 终端节点；窗口组件属性通过该接收节点读取最终值，不能直接把接收节点作为图内数值边的来源。
- 图形/CL2 往返必须保留每条数值边的源节点、源端口、目标节点和目标端口，以及所有节点的位置；`reusablevalue`/`inputvalue` 也须读写 `@cl2.pos`，旧源码缺少位置时载入模型必须补齐有效坐标，避免连线路径生成 `NaN`。流程节点保持蓝色，流程起点蓝色并显示 Home 图标，纯值节点绿色，数值接收节点紫色。
- 纯数值蓝图只验证数值节点、数值接收节点和数值连线，不得要求 `flowStart`、流程出口或流程连线；`blockUntil` 的单一布尔参数必须绑定到 `condition`。
- 普通问诊对话组件不得渲染结局立绘占位标签；`dorm-bottom` 必须只路由到 `ending-screen`，不能继续作为普通对话窗口的接收目标。
- 窗口调试器属于运行时调试工具，必须放在开发人员模式窗口的下方“调试器（运行时 / 存档状态）”区域，不得归入上方 JSON 数据编辑器区域。
- 下班模式中所有“交流”和室友条目按钮必须直接运行对应 Activity，由 `dorm-bottom` 路由自动打开 `ending-screen`；不得先调用 `openWindow("dialogue")`。
- `activityExpiry.expires` 是“启用绝对过期时间”的标志，不是“已过期”结果；只有标志为 true 时才比较 `expiresAt`，否则 Activity 不得因该字段被拒绝。
- `dorm-bottom` 的文本节点即使未声明 `continueKey` 也必须由通用 ActivityRunner 生成稳定的节点等待键；室友结局窗口的继续按钮必须真正推进 Activity，而不是只更新 DOM。
- CL2 `choice` 必须同时保存 `options` 标签、`optionCount` 和稳定 `selectionKey`；只有流程分支而没有选项数据时不得渲染成继续按钮或空控件。
- 文本节点从继续等待状态恢复时必须消费等待键并直接进入下一流程节点，不能再次派发同一句文本；否则后续 `choice` 永远不会到达界面。
- 未声明 `displayTo` 的 `choice` 节点必须继承前一条对白的接收目标；否则下班模式的选项事件会落到 `default`，结局窗口只会残留“继续”按钮。
- choice 等待恢复时必须先读取并消费已有的 `selectionKey`，再决定是否发送显示事件；不能在点击后再次发送同一 choice，阻止流程进入所选 `option` 分支。

1. 使用 `patch` 或 `write_file` 修改，只改任务需要的文件。
2. 写入文档前先评估内容是否是所有后续任务都必须遵守的规则；只有这类稳定约束才写入 `AGENTS.md`，项目背景、实现索引、过程说明和可变信息写入 `docs/agent-notes.md`，面向人类的使用说明才写入 `README.md`。
3. 每次对代码、数据 schema、引擎架构、层职责、开发命令、版权或发布行为做出修改后，必须检查并同步更新 `AGENTS.md`、`docs/agent-notes.md` 和 `README.md`。三份文档分别保持：代理规则、代理补充信息、人类阅读介绍；不能只更新其中一份。
4. 文档同步必须在同一个修改任务中完成，并检查三份文档之间的引擎名称、`core/framework/game` 边界、许可证和命令没有矛盾；纯文档修改也要检查是否影响另外两份。
5. 修改 JavaScript 后执行 `node --check`；修改 JSON 后用 Python `json.load()` 全量校验；始终执行 `git diff --check`。
6. 状态、存档、Activity 或边界改动必须增加或运行确定性探针，覆盖初始值、边界、失败路径、恢复和副作用。
7. 需要验证发布产物时执行 `node tools/verify-publish.js`；该命令会生成并检查发布产物、检查入口语法，然后无论成功失败都删除 `publish/`。确认产物不含 `DEV-TOOLS`、`DeveloperMode`、`dev-server.js` 或迁移/调试入口。
8. 静态检查、探针和浏览器交互验证要分别如实报告；没有真实运行就不能声称 UI 已验证。
9. `dev-server.js` 提供静态文件时必须先解码 URL 百分号编码，再执行根目录穿越校验，以保证中文 canonical Activity 路径可加载。
10. 除非用户明确要求，不创建 PR。
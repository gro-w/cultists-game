# CL2（Cultists Blueprint & Script Language 2）语言手册

> 面向人类读者的 CL2 生产语言手册。Activity 运行时、编辑器和内嵌蓝图均使用 CL2；旧 JSON 仅作为离线迁移审计输入。
>
> Agent 编写 CL2 时应加载 [`docs/skills/cl2-script-authoring/SKILL.md`](skills/cl2-script-authoring/SKILL.md)，其中包含读取仓库契约、编辑文件和验证脚本的操作流程。

## 阅读范围

本手册说明 CL2 的语法、图语义、节点类型、值表达式、分支、循环、布局元数据和验证规则。它是语言契约，不是某个具体 Activity 的剧情或业务说明；具体函数和端口仍以项目的节点注册表为准。

## 1. 设计目标

CL2 是一种面向蓝图图结构的脚本化文本语言。它使用接近 C/C++ 的语法外观，但不追求实现通用 C++ 语义。

目标如下：

- 人类可以直接阅读节点、分支和连线
- AI 可以稳定生成节点 ID、值边和流程边
- 文本中的每个流程节点都能直接对应一个蓝图节点
- 文本中的每个 `option`、`default` 都能直接对应一个流程端口
- 纯函数表达式直接对应数值节点和值边
- 图编辑器可以修改 CL2 文本中的布局和连接，而不需要维护第二份 JSON 图定义
- Activity 加载时可以把已验证的 CL2 流程图即时编译为 JavaScript 执行器
- 不把 CL2 编译成另一种 canonical JSON，也不要求从 JSON 反编译回 CL2

实现仍然需要词法解析、语法解析、端口验证和图验证。解析图供运行时、编译器和编辑器共用；JIT 生成的 JavaScript 只存在内存中，不取代 canonical CL2 源码。

```text
CL2 source
    ↓ parse + validate
Blueprint Graph
    ├─→ JavaScript flow executor → Activity Runtime
    └─→ Graph Editor
```

编译结果保留稳定步骤 ID、节点到生成源码行/端口/流程目标的 source map 和生成源码，供开发人员模式查看；源码行号随代码块增量累计，禁止为每个节点重复扫描生成源码前缀；Activity Runner 同时公开当前步骤、等待状态、已执行节点和实例本地变量。调试器通过相同稳定节点 ID 选择执行位置并设置断点。编译与调试元数据仅驻留内存，不写入存档或覆盖 canonical CL2 文件；Activity 实例的执行进度、trace、已执行节点、断点列表和暂停断点 ID 属于运行状态，随队列存档保存。恢复后 runner 停在已保存断点，继续时只跳过该断点本身一次再执行节点；其他已完成的一次性副作用仍由实例的 executed-node 状态防止重放。

CL2 不是按文件顺序执行的普通脚本。文件中的执行关系由 `option<x>`、`default` 和纯值依赖决定。

## 2. 文件结构

一个 CL2 文件由以下内容组成：

```text
reusable value declarations
flow node declarations
comments and layout metadata
```

推荐的总体形式：

```cl2
reusablevalue a1: math['gt', getpubvar[1], 4];

node01: showtext("test1") {
    default node02;
}; /** @cl2.pos 0,0 */

node02: showtext("test2");

end: end();
```

文件声明顺序不决定普通节点的执行顺序，只有在省略 `default` 时，声明顺序才用于计算隐式后继节点。

## 3. 流程节点

流程节点必须有显式、唯一的节点 ID：

```cl2
node-id: function(arguments) {
    edge declarations
};
```

最小示例：

```cl2
node01: showtext("test1");
```

约束：

- 每个流程节点必须显式写出 `node-id`
- 节点 ID 在文件内必须唯一
- `node-id` 是稳定标识，不使用显示名称、翻译文本或函数参数生成
- `node-id` 可以被其他节点的流程边引用
- 节点 ID 不应因为标签名称或显示文本改变而自动改变
- 流程函数使用圆括号：`function(...)`
- 纯值函数使用方括号：`function[...]`
- 流程函数不能嵌套在另一个流程函数的参数中

推荐的节点 ID 字符集为：

```text
[a-zA-Z_][a-zA-Z0-9_.-]*
```

`default`、`option`、`reusablevalue`、`end` 等保留字不能作为节点 ID 使用。

## 4. 流程边

CL2 只有两类流程边声明：

```cl2
option<x> target;
default target;
```

### 4.1 `option<x>`

`option<x>` 表示第 `x` 个显式分支出口。分支编号从 `1` 开始：

```cl2
option<1> node01;
option<2> node02;
```

### 4.2 `default`

`default` 表示默认流程出口：

```cl2
default node03;
```

`default` 不是普通节点跳转语句，而是当前节点注册契约中的默认流程端口。

所有没有被显式 `option<x>` 接管的流程情况都进入 `default`。

### 4.3 隐式 default

如果节点没有显式写 `default`，则默认出口连接到源文件中的下一个流程节点：

```cl2
node01: showtext("test1");
node02: showtext("test2");
```

等价于：

```cl2
node01: showtext("test1") {
    default node02;
};

node02: showtext("test2");
```

因此默认边的解析优先级是：

```text
显式 default target
    ↓ 没有
下一个流程节点
    ↓ 没有
无 default 出口
```

终止节点是例外。`end()` 没有流程出口，不使用隐式后继：

```cl2
end: end();
```

### 4.4 未连接分支的回退

如果节点运行时选择了一个没有显式连接的 `option<x>`，则回退到 `default`：

```cl2
node01: playerselect(3, "A", "B", "C", "其他") {
    option<1> nodeA;
    option<2> nodeB;
    default end;
};
```

`option<3>` 未连接，因此：

```text
option<3> → default → end
```

如果 `default` 也省略，则继续使用隐式下一个节点。

## 5. `if`

`if` 使用固定的两个流程出口：

```text
option<1> = condition 为 true
default   = condition 为 false
```

示例：

```cl2
node03: if(a1[]) {
    option<1> node02;
    default node04;
};
```

等价于：

```text
true  → node02
false → node04
```

省略 `default` 时，false 路径进入隐式后继：

```cl2
node03: if(a1[]) {
    option<1> node02;
};
```

`if` 的条件必须是 `bool` 类型的值表达式。

## 6. `switch`

标准 `switch` 接受 `x + 1` 个参数：

```cl2
switch(x, condition1, condition2, ..., conditionX)
```

其中：

- 第一个参数是分支数 `x`
- 后续 `x` 个参数是按顺序检查的条件表达式
- 每个条件必须返回 `bool`
- 条件从上到下依次匹配
- 第一个为 `true` 的条件选择对应的 `option<n>`
- 全部条件为 false 时选择 `default`

示例：

```cl2
node04: switch(
    3,
    isCritical[],
    isAdult[],
    isKnownPatient[]
) {
    option<1> critical;
    option<2> adult;
    option<3> known;
    default other;
};
```

语义：

```text
isCritical      为 true → option<1>
isAdult         为 true → option<2>
isKnownPatient  为 true → option<3>
全部为 false             → default
```

如果多个条件同时为 true，只执行编号最小、文本位置最靠前的匹配分支。

`switch` 的分支数量决定图结构，第一版建议要求第一个参数为正整数常量：

```cl2
switch(3, a1[], a2[], a3[])
```

不建议第一版让 `switch` 的端口数量在运行时动态变化。

## 7. `range`

标准 `range` 接受 `x` 个参数：

```cl2
range(x, boundary1, boundary2, ..., boundaryX-1)
```

其中：

- 第一个参数是分支数 `x`
- 后续有 `x - 1` 个数值边界
- 边界必须严格递增
- 边界将数值划分为 `x` 个分支

推荐使用左闭右开区间，最后一个分支向正无穷延伸：

```text
value < boundary1
boundary1 <= value < boundary2
boundary2 <= value < boundary3
...
value >= boundaryX-1
```

示例：

```cl2
node05: range(4, 10, 20, 30) {
    option<1> low;
    option<2> medium;
    option<3> high;
    option<4> veryHigh;
    default other;
};
```

语义：

```text
value < 10          → option<1>
10 <= value < 20    → option<2>
20 <= value < 30    → option<3>
value >= 30         → option<4>
```

如果某个范围分支没有显式连接，则该分支回退到 `default`。

验证器必须检查：

```text
x >= 1
参数总数 = x
边界数量 = x - 1
boundary1 < boundary2 < ... < boundaryX-1
```

## 8. `playerselect`

`playerselect` 接受一个选项数量、若干选项文本和一个默认文本：

```cl2
playerselect(count, text1, text2, ..., textN, defaultText)
```

参数含义：

```text
第一个参数：运行时选项数量
中间参数：选项文本槽位
最后一个参数：缺失文本的填充文本
```

示例：

```cl2
node06: playerselect(
    getpubvar[3],
    "调查患者",
    "查看病历",
    "离开",
    "其他选项"
) {
    option<1> node01;
    option<2> node02;
    option<3> node03;
    default end;
};
```

运行时规则：

- `count` 小于文本槽位数量时，只显示前 `count` 个选项
- `count` 等于文本槽位数量时，显示所有文本
- `count` 大于文本槽位数量时，缺少的文本使用 `defaultText`
- 未连接的 `option<x>` 回退到 `default`
- 没有显式 `default` 时，未连接选项回退到隐式下一个节点

需要区分：

```text
defaultText：UI 文本的填充内容
default：流程图的默认出口
```

两者是独立的语义。

## 9. 分支连接语法糖

### 9.1 离散分支集合

```cl2
option<1,3,5> oddBranch;
```

等价于：

```cl2
option<1> oddBranch;
option<3> oddBranch;
option<5> oddBranch;
```

### 9.2 连续分支集合

```cl2
option<1...4> lowBranch;
```

等价于：

```cl2
option<1> lowBranch;
option<2> lowBranch;
option<3> lowBranch;
option<4> lowBranch;
```

`option<1...4>` 是分支编号的展开语法，不是运行时数值区间。运行时数值区间只由 `range(...)` 定义。

以下两者含义不同：

```cl2
option<1...4> target;
range(4, 10, 20, 30);
```

前者是把四个图端口连接到同一目标，后者是根据运行时数值计算实际分支。

## 10. 可复用值节点

纯函数使用方括号：

```cl2
math['gt', getpubvar[1], 4]
```

可通过 `reusablevalue` 为纯值子图命名：

```cl2
reusablevalue a1: math['gt', getpubvar[1], 4];
reusablevalue a2: math['and', a1[], true];
```

`a1[]` 是对可复用值 `a1` 的引用，不是流程节点调用：

```cl2
node03: if(a1[]) {
    option<1> node02;
};
```

对应数值图：

```text
getpubvar[1] → math['gt']
4             → math['gt']
math['gt']    → a1

a1            → math['and']
true          → math['and']
math['and']   → a2

a1            → node03.condition
```

纯值图规则：

- 每个纯函数调用对应一个数值节点
- 纯函数参数引用形成数值边
- 纯函数可以嵌套其他纯函数
- 纯函数不能包含流程函数
- 纯函数不能推进游戏时间、修改变量、打开窗口、触发事件或写存档
- `reusablevalue` ID 必须唯一
- 可复用值之间不能形成循环依赖
- `a1[]` 必须引用已声明或最终可解析的可复用值

### 10.1 四类节点与纯数值蓝图

节点类别由注册表的四组引脚决定，而不是由函数名称或文件位置猜测：

| 类别 | 流程输入 | 流程输出 | 数值输入 | 数值输出 | CL2 形式 |
| --- | --- | --- | --- | --- | --- |
| 流程节点 | 有 | 可有 | 可有 | 无 | `node: function(...)` |
| 纯值节点 | 无 | 无 | 可有 | 有 | `reusablevalue name: function[...]` |
| 流程起点 | 无 | 有 | 可有 | 无 | `node: flowStart(...)` |
| 数值接收节点 | 无 | 无 | 有 | 无 | `inputvalue receiver: valueReceiver[expression[]]` |

纯数值蓝图只包含纯值节点、数值接收节点和它们之间的数值连线。它服务于窗口组件属性、筛选条件等需要计算值的声明式区域，不是一个可独立调度的 Activity 流程。因此：

- 纯数值蓝图不要求 `flowStart`、流程出口、流程边或 `activityEnd`
- 纯数值蓝图只验证数值节点、数值接收节点、输入引脚、数值输出和数值连线
- 纯数值表达式不能推进时间、修改变量、打开窗口、触发事件或写存档
- 不要为了满足 Activity 流程校验而伪造 `flowStart`、`default` 或 `end()`；这会把值图错误地变成流程图
- 如果同一文件同时包含 Activity 流程，才按 Activity 流程规则要求唯一的 `flowStart`、可达终止节点和合法流程边

数值接收节点没有数值输出，因此不能被图内 `reusablevalue` 或其他数值节点引用；它通过唯一的 `value` 输入接收纯值表达式。窗口组件属性可以把接收节点 ID 作为图的外部结果读取，运行时会求值其 `value` 输入；该外部绑定不是图内数值输出。使用 `inputvalue` 声明接收节点：

```cl2
inputvalue a1: math['gte', getlocalvar[1], 4];
```

其中 `a1` 是数值接收节点的稳定 ID，右侧是普通纯值表达式。`inputvalue` 不产生流程边；同一接收节点的输入槽不得重复绑定，必填输入必须全部有字面量、数值边或 `inputvalue` 绑定。

例如，下面是一个合法的纯数值蓝图片段：

```cl2
reusablevalue mental: getPublicVariable[5];
reusablevalue hasEnoughSan: arithmetic[">=", mental[], 20];
inputvalue visibleWhen: valueReceiver[hasEnoughSan[]];
```

它有两个可复用值和一个接收绑定，没有 `flowStart`、`default`、流程出口或 `end()`。`visibleWhen` 是接收节点的稳定 ID；窗口组件可把该 ID 作为外部属性值读取，但其他图节点不能将它作为数值来源。

下面的写法不合法：

```cl2
inputvalue visibleWhen: if(hasEnoughSan[]);
```

`if` 是流程节点，不是纯值函数；它不能出现在 `inputvalue` 的右侧。应使用返回 `bool` 的纯函数，例如 `hasEnoughSan[]` 或 `math['gte', ...]`。

简单纯函数可以直接内联：

```cl2
node03: if(math['gt', getpubvar[1], 4]) {
    option<1> node02;
};
```

## 11. 循环与回边

CL2 不设置特殊的循环节点。循环唯一通过流程图回边表达。

推荐的 `while` 结构：

```cl2
check: if(condition[]) {
    option<1> body;
    default after;
};

body: action() {
    default check;
};

after: end();
```

这表示：

```text
check.true → body → check
check.false → after
```

对应：

```cpp
while (condition) {
    action();
}
```

`do-while` 将检查节点放在循环体之后：

```cl2
body: action() {
    default check;
};

check: if(condition[]) {
    option<1> body;
    default after;
};

after: end();
```

`continue` 是回到检查节点的普通边，`break` 是连接到循环外部的普通边，不设置特殊语句或特殊节点。

CL2 的循环语义仍是普通流程图回边。JIT 编译器为每个流程节点生成专门的 JavaScript 操作，并把静态后继边和值表达式编入代码；数字程序计数器仅负责选择分支与维持逐节点暂停、保存、恢复和调试检查点，不再调用通用 `executeNode` 解释器。每步仍更新队列中的存档状态；Runner 使用实例内集合索引已执行节点和断点，避免随 trace 增长逐步扫描存档数组。同步节点间不逐步广播 `activity:changed`，仅在等待、断点和终止等执行边界通知窗口，避免同步重绘开销。

验证器应识别流程图中的环。建议默认要求可达循环包含一个能够离开循环的 `if` 控制节点；没有条件出口的无限环应报告验证错误，只有明确声明允许无限循环时才放行。

## 12. 布局元数据与 Note

节点位置使用机器可识别的注释：

```cl2
node01: showtext("test1"); /** @cl2.pos 0,0 */
reusablevalue calc: arithmetic["+", 1, 2]; /** @cl2.pos 220,0 */
inputvalue result: valueReceiver[calc[]]; /** @cl2.pos 440,0 */
```

规则：

- 流程节点、`reusablevalue` 和 `inputvalue` 声明均可附加 `@cl2.pos`，图形编辑器必须读写该坐标
- 没有坐标时由编辑器自动布局
- 自动布局结果不应在每次打开文件时自动写回
- 布局元数据不能改变流程或数值语义

注释不依赖换行，统一使用 `/* ... */` 块注释；`//` 不是合法 CL2 语法：

```cl2
/* 患者已经完成身份确认 */
node01: showtext("test1");
```

蓝图 Note 使用专用格式：

```cl2
/* @cl2.note note001 @pos 100,100: 这里是紧急流程入口 */
```

Note 具有独立的稳定 ID，不参与运行时流程，不产生节点或边。

## 13. 图与文本的一致性

CL2 与 Blueprint Graph 之间应保持以下一一对应关系：

```text
流程节点声明       ↔ 一个流程节点
option<x>          ↔ 一个指定流程出口
显式 default       ↔ 一个 default 流程边
隐式 default       ↔ 根据文件顺序解析出的 default 流程边
纯函数调用         ↔ 一个数值节点
纯函数参数引用     ↔ 一条数值边
reusablevalue      ↔ 一个命名的纯值子图入口
inputvalue         ↔ 一个数值接收节点及其输入绑定
@cl2.pos           ↔ 节点布局元数据
```

CL2 文本的行顺序不应影响已经显式声明的连接。只有省略 `default` 的节点依赖文本顺序；移动这种节点可能改变其隐式后继，因此编辑器在改变节点顺序时必须谨慎处理隐式 default。

## 14. 节点注册契约

CL2 解析器不应硬编码具体游戏业务。流程函数和纯函数的端口、类型和副作用由节点注册表提供。

流程节点注册至少需要声明：

```text
节点 ID
输入端口及类型
option 端口规则
是否有 default 端口
副作用和权限
是否为终止节点
```

纯函数注册至少需要声明：

```text
函数 ID
输入参数类型
输出类型
是否允许调用其他纯函数
是否允许读取 query 状态
```

例如 `if` 的通用端口契约为：

```text
输入：condition: bool
输出：option<1>, default
```

`end` 的通用端口契约为：

```text
输入：无或节点定义要求的输入
输出：无
```

`core` 提供通用解析、验证、图执行和存档能力；具体节点及其业务数据由 framework/game 按现有依赖方向注册。

## 15. 验证要求

加载 CL2 时至少执行：

1. 词法和语法检查
2. 节点 ID 唯一性检查
3. 节点类型注册检查
4. 流程函数参数检查
5. 纯函数参数和返回类型检查
6. `option<x>` 合法性检查
7. `default` 合法性检查
8. 目标节点存在性检查
9. `switch` 条件数量和布尔类型检查
10. `range` 参数数量、边界数量和边界顺序检查
11. `playerselect` 文本参数与 defaultText 检查
12. 可复用值循环依赖检查
13. 不可达节点和不可达分支检查
14. 流程环和循环出口检查
15. 终止节点没有流程出口的检查
16. 节点引脚类别检查：流程、纯值、流程起点和数值接收节点不得混用非法引脚组合
17. 纯数值蓝图不得被错误要求 `flowStart`、流程出口、流程边或 `activityEnd`
18. `inputvalue` 的接收节点 ID、输入槽、纯值表达式和数值边检查
19. `inputvalue` 与 `reusablevalue` 的往返分类保持为 `valueReceiver`，不能降级为普通纯值节点

错误必须保留源文件、行号、列号和节点 ID，例如：

```text
cl2/example.cl2:18:5
node node05: option<3> has no registered output or default fallback
```

解析错误不应丢弃整个文件。编辑器应保留可解析的节点、边和原始错误文本，以便用户继续修复。

## 16. 完整示例

```cl2
reusablevalue isAdult: math['gte', getpubvar[1], 18];
reusablevalue isCritical: math['and', isAdult[], getpubvar[2]];

node01: showtext("test1") {
    default node02;
}; /** @cl2.pos 0,0 */

node02: showtext("test2"); /* implicit default: node03 */

node03: if(isCritical[]) {
    option<1> critical;
    default node04;
}; /** @cl2.pos 100,0 */

node04: switch(
    3,
    isCritical[],
    isAdult[],
    getpubvar[3]
) {
    option<1> critical;
    option<2,3> normal;
    default end;
}; /** @cl2.pos 200,0 */

normal: range(4, 10, 20, 30) {
    option<1> low;
    option<2> medium;
    option<3> high;
    option<4> veryHigh;
    default end;
}; /** @cl2.pos 300,0 */

patient_menu: playerselect(
    getpubvar[4],
    "调查患者",
    "查看病历",
    "离开",
    "其他选项"
) {
    option<1> node01;
    option<2> node02;
    option<3> node03;
    default end;
}; /** @cl2.pos 400,0 */

check_loop: if(getpubvar[5]) {
    option<1> loop_body;
    default end;
}; /** @cl2.pos 500,0 */

loop_body: consumeTime(20) {
    default check_loop;
}; /** @cl2.pos 600,0 */

critical: showtext("critical");
end: end();
```

这个示例同时展示：

- 显式流程节点 ID
- 纯值节点和可复用值
- `if` 的 true/default 分支
- 按顺序匹配的 `switch`
- 区间 `range`
- `option<1,3>` 连接糖
- 动态 `playerselect`
- 隐式 default
- `if` 回边形成的循环
- 节点位置元数据

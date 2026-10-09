# 游戏开发补充说明

本文件只记录父仓库的游戏内容结构与开发入口。引擎实现、CL2 语言规范和 core/framework 通用工具请查阅 [`engine/README.md`](../engine/README.md) 与 [`engine/docs/`](../engine/docs/)；本仓库必须遵守的规则见 [`../AGENTS.md`](../AGENTS.md)。

## 仓库边界

```text
index.html                 游戏入口，加载 engine/core/entrypoint.js 与 data/
data/                      本作的 canonical 内容与游戏资源
docs/                      游戏专属指南、规则、技能和宣传材料
engine/                    Cultists 引擎 Git 子模块（core/framework 与通用开发工具）
dev-server.js              父仓库根目录的开发服务器入口
probes/                    游戏内容与集成的确定性探针
```

父仓库远端是 `https://github.com/gro-w/cultists-game`。`engine/` 是独立子模块，URL 为 `https://github.com/gro-w/cultists`，跟踪 `main`。修改引擎代码或引擎文档时，应进入子模块自己的工作区单独检查；完成引擎提交后再更新父仓库的 gitlink。

## 内容入口

- `data/game-manifest.json`：游戏包入口、初始状态、manifest 引用、队列与默认 Activity。
- `data/framework-manifest.json`、`data/framework-runtime.framework.json`、`data/activity-manifest.json`：内容包接入 framework、运行时集合和 Activity。
- `data/activities/`：游戏 Activity；以 `activity-manifest.json` 实际列出的文件为准，当前生产脚本为 `.CL2.txt`。
- `data/windows/`：游戏窗口定义。
- `data/databases/`：患者、症状、诊断、药物、NPC、关键词、成就、结局、事件等 canonical 数据。
- `data/assets/` 与 `data/media.json`：游戏资源及媒体索引；资源 ID 应保持稳定。
- `data/activity-lists/`、`data/activity-calendar.json`、`data/calendar-rules.json`：Activity 分类、日期编排与日历规则。
- `data/bgm.json`、`data/social-apps.json`、`data/item-placements.json`、`data/virtual-filesystem.json`：游戏自己的音乐配置、应用、初始物品摆放和虚拟文件树。

`data/activities/` 中可能同时存在图形编辑器/迁移用途 JSON 与 `.CL2.txt`。判断生产定义时以 Activity manifest 指向的源文件、Activity 编辑器契约和当前引擎定义加载器为准；不要通过扩展名或修改时间自行推断 canonical owner。

## 游戏内容约定

- 初始状态在 `data/game-manifest.json` 声明；当前配置为第 1 天 08:00、白天、上班、工作地点。时间和日程行为由数据与 Activity 明确驱动。
- 当前可玩范围为第 1–7 天；第 8–31 天仅为日历未解锁占位。
- 患者记录位于 `data/databases/patients.json`，通过稳定 `dialogueActivityId` 关联对应问诊 Activity，并用稳定诊断 ID 关联 `diagnoses` 数据。
- 症状、普通关键词、低 SAN 关键词和疾病关键词均从 `data/databases/keywords.json` 查询。每种疾病 normal/low 版本使用独立 ID；收集与显示行为不能把已收集版本静默替换成当前 SAN 版本。
- 游戏数据库是 canonical 内容，不是存档数据。编辑器写盘修改数据文件；存档调试器只操作运行时存档/状态。
- 长时间内容成本应在 Activity 流程中分段表现；不要由窗口 JavaScript 推进游戏时钟。

## 本地运行与开发

项目为原生 HTML/CSS/ES modules，无依赖安装及构建步骤。只读浏览可从仓库根目录运行：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

访问 `http://127.0.0.1:8000/`。开发编辑器需要额外启动根目录入口：

```bash
node dev-server.js
```

用 `http://127.0.0.1:8000/?dev` 打开开发人员模式。开发服务器仅绑定本机。`data/data-files.json` 管理可编辑文件清单；变更 canonical 文件时同步核对清单和各自 schema。

## 相关文档

- [`skills/game-schedule-patient-dialogue/SKILL.md`](skills/game-schedule-patient-dialogue/SKILL.md)：患者问诊内容的现行编写和检查流程。
- [`media/poster-a2.html`](media/poster-a2.html)、[`media/poster-a4-landscape.html`](media/poster-a4-landscape.html)：自包含 HTML 海报版式；其中 `../../data/assets/` 路径相对海报 HTML 文件本身解析。
- [`media/poster-A4.png`](media/poster-A4.png)：A4 海报静态预览。
- [`../copying.txt`](../copying.txt)：游戏内容权利声明。
- [`../engine/docs/cl2-language.md`](../engine/docs/cl2-language.md)：CL2 语言参考。
- [`../engine/docs/skills/cl2-script-authoring/SKILL.md`](../engine/docs/skills/cl2-script-authoring/SKILL.md)：引擎侧 CL2 脚本编辑和验证流程。

## 验证

按改动选择探针，不把静态检查描述成浏览器验收。常用检查：

```bash
# JSON 语法
python3 -c 'import json, pathlib; [json.load(open(p, encoding="utf-8")) for p in pathlib.Path("data").rglob("*.json")]'

# JavaScript 语法
node --check dev-server.js

# 工作区空白错误与子模块状态
git diff --check
git -C engine diff --check
git submodule status
```

游戏内容集成探针位于 `probes/`；引擎通用探针位于 `engine/probes/`。运行具体探针前先确认其实际文件及命令存在，并分别报告静态验证、运行时探针和浏览器操作结果。

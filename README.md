# 《完蛋，我被邪教徒包围了！》

`surrounded by cultists` 是一款 Windows 95 风格、数据驱动的网页互动游戏。白天，玩家在医院信息系统中接诊患者；离开工作后，回到宿舍与室友交流、调查物品、收集线索，并面对逐渐失控的现实。

## 当前内容

- 患者问诊、诊断与处方
- 宿舍、室友交流、物品调查、关键词笔记本与法术
- 确定性游戏时钟、日程、事件、成就和多种结局
- 数据驱动桌面、窗口和社交应用

游戏目前可玩日为第 1–7 天；日历还显示第 8–31 天的未解锁占位。更多故事内容以后续游戏数据为准。

## 运行

项目无需安装依赖或构建，使用本地 HTTP 服务打开根目录：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

访问 <http://127.0.0.1:8000/>。需要编辑 canonical 内容时，在仓库根目录运行：

```bash
node dev-server.js
```

开发工具只在 `http://127.0.0.1:8000/?dev` 启用。开发服务器仅供本机使用，不要暴露到公共网络。

## 仓库结构

- `data/`：本作的 Activity、窗口、数据库、日历、manifest 与游戏资源
- `docs/`：游戏专属开发指南、内容制作流程与宣传材料
- `engine/`：独立 Cultists 引擎子模块，含 core/framework、通用编辑器、探针及引擎文档
- `index.html`：游戏入口，通过 `#data-location` 选择根目录 `data/`

引擎子模块指向 `https://github.com/gro-w/cultists` 的 `main` 分支；访问该私有仓库是递归克隆和初始化完整项目的前提。引擎架构与独立示例见 [`engine/README.md`](engine/README.md)。

## 文档

- [`AGENTS.md`](AGENTS.md)：游戏仓库的协作规则与内容边界
- [`docs/agent-notes.md`](docs/agent-notes.md)：游戏数据索引、开发入口与验证说明
- [`docs/skills/game-schedule-patient-dialogue/SKILL.md`](docs/skills/game-schedule-patient-dialogue/SKILL.md)：制作与校验患者问诊 Activity 的流程
- [`docs/media/`](docs/media/)：本作宣传海报
- [`engine/docs/`](engine/docs/)：引擎专属语言和开发文档

## 内容权利

本作剧情、角色、对话、医疗内容、游戏数据、美术与其他游戏素材保留各自权利人的版权；引擎许可证不适用于这些游戏内容。详情见 [`copying.txt`](copying.txt)。

# VOID SHIFT

VOID SHIFT 是一款俯视角科幻生存回收网页游戏。玩家需要探索程序化生成的废弃设施、破解安全终端、回收废料，并在 Hunter 与主怪物的追击下撤离。

当前版本支持单人游戏及两人联机，提供地图规模、难度、Hunter 参数和武器 Loadout 调整，并已部署到 OpenAI Sites。

## 在线版本

- 私有站点：[VOID SHIFT](https://void-shift-recovery.hongwei1408.chatgpt.site)
- 只有站点拥有者及已获邀请的账号可以访问。
- 在线存档使用该域名下的浏览器 `localStorage`，不会自动继承 localhost 的存档。

## 主要功能

- 单人及两人联机任务。
- 小型、中型、大型三种程序化设施。
- 简单、中等、困难与自定义难度。
- 可调整每张地图的 Hunter 开场数量、重生间隔、每轮重生数量与生命值。
- 手枪与冲锋枪 Loadout；冲锋枪支持按住左键自动射击，弹匣耗尽后自动换弹。
- Hunter 会寻找门口和局部安全路径绕开墙角，死亡后失去碰撞、后退并淡出。
- 子弹优先命中射线上最近的目标，墙壁与前方 Hunter 会阻挡后方目标。
- 主怪物保留穿墙追猎能力，并可被连续命中触发短暂瘫痪。
- 战争迷雾、局部雷达、全局地图、立体声空间音频、背包与终端 QTE。

## 地图与难度

| 地图 | 舱室 | 回收配额 | 安全终端 | 中等 Hunter 数量 | 每轮重生 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 小型 | 12 | ¥420 | 3 | 24 | 1 |
| 中型 | 18 | ¥780 | 3 | 32 | 2 |
| 大型 | 24 | ¥1200 | 4 | 50 | 3 |

默认重生间隔统一为 30 秒。

| 难度 | Hunter 数量 | 每轮重生数量 | Hunter HP |
| :--- | :--- | :--- | ---: |
| 简单 | 中等的 0.5 倍 | 中等的 0.5 倍，向上取整 | 1 |
| 中等 | 地图默认值 | 地图默认值 | 2 |
| 困难 | 与中等相同 | 与中等相同 | 5 |

手动修改任一 Hunter 参数后，难度会显示为“自定义”。每张地图的自定义值会分别保存，并在下一次下潜时生效。

## 两人联机

1. 两名玩家都打开在线站点，并进入 `CO-OP` 页签。
2. 房主选择“创建双人房间”，把 6 位房间码发给队友。
3. 队友输入房间码加入；双方选择 Loadout 并点击“准备”。
4. 双方准备完成后，由房主开始任务。
5. 一名玩家倒地后，队友靠近并按 `E` 可以救援。

联机采用 WebRTC 点对点传输，Sites Worker 与 D1 只负责限流、房间码和握手信令。房主负责地图、敌人、伤害、掉落、QTE 与结算等权威状态。

当前联机限制：

- 仅支持两人房间。
- 使用 STUN，不提供 TURN 中继；部分严格 NAT 或企业网络可能无法建立连接。
- 暂无断线重连、房主迁移及中途加入。
- 双方需使用相同的在线部署版本。

## 操作指南

| 按键 / 操作 | 功能 |
| :--- | :--- |
| `W / A / S / D` | 移动 |
| 鼠标移动 | 控制朝向与手电筒方向 |
| 鼠标左键 | 开火；冲锋枪可按住连射 |
| 鼠标右键 | 瞄准并降低散布 |
| `R` | 手动换弹 |
| `E` | 拾取、开关门、接入终端或救援队友 |
| `M` | 打开 / 关闭全局战术地图 |
| `F` | 开关手电筒 |
| `B` | 打开 / 关闭背包 |
| `Shift` | 疾跑并提高噪音 |
| `X` | 全部终端破解后呼叫撤离 |
| `Esc` | 关闭地图或取消当前 QTE |

## 本地运行

### 只运行单人游戏

单人模式仍可直接作为静态网页运行：

```bash
python -m http.server 8000
```

然后打开 `http://localhost:8000`。浏览器第一次进入后需要点击页面一次，才能启用 Web Audio。

### 运行完整联机版本

需要 Node.js 22.13 或更高版本，以及 pnpm 11.25：

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm exec wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_damp_jack_murdock.sql
pnpm exec wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_rainy_kylun.sql
pnpm start
```

根据终端显示的地址打开两个浏览器窗口，即可进行本地联机验证。后续启动时不需要重复执行 migration。

## 技术结构

- 游戏：原生 JavaScript、HTML5 Canvas、Web Audio API。
- 联机：WebRTC DataChannel，房主权威状态同步。
- 信令：Sites Worker API。
- 房间数据：Cloudflare D1，短期保存 SDP 信令并自动过期。
- 托管：OpenAI Sites。
- Sites 外壳：React 19、Vinext、Vite 与 TypeScript。

重要目录：

```text
app/                  Sites 页面与联机 API
db/                   D1 schema
drizzle/              D1 migrations
js/                   游戏逻辑与 WebRTC 客户端
resources/            游戏音效资源
scripts/              构建与游戏文件同步脚本
index.html             游戏入口
styles.css             游戏界面样式
.openai/hosting.json   Sites 项目与 D1 配置
```

以下目录均为本地构建或运行时生成内容，已加入 `.gitignore`，不要提交：

```text
.next/
.sites-runtime/
.sites-starter/
.wrangler/
dist/
node_modules/
public/game/
```

## 发布

Sites 项目 ID 已保存在 `.openai/hosting.json`。发布前应先运行构建，并确认 D1 migrations 已随部署归档包含。生产站点保持私有访问；如需新增访问者，请在 Sites 的访问权限中邀请对应邮箱。

# DSH 对话删除插件

在 DeepSeek Harness 网页版的侧边栏里，给每个对话的「…」菜单加一项 **删除对话**，
点两下就能把这个对话从本地真正删掉。

插件名：`dsh-conversation-delete`
当前版本：1.0.0

---

## 一、怎么用

1. 鼠标移到侧边栏任意对话上，点它右侧的「…」。
2. 菜单里选 **删除对话**（排在「复制会话 ID」后面）。
3. 菜单项会变成红色的「确认删除？不可恢复」，**6 秒内再点一次**才真的删。
4. 删除成功后对话立刻从列表消失，不需要刷新页面。

如果这个对话正在生成回复，会拒绝删除并提示「这个对话还在运行，请等本轮结束或先停止」，
等这一轮结束或点了停止之后再删即可。

---

## 二、删掉了什么

| 删除对象 | 路径 / 位置 | 说明 |
| --- | --- | --- |
| 会话日志 | `~/.dsh/sessions/<项目目录>/<会话 ID>/` | 对话正文，删掉就没了 |
| 投影缓存 | `~/.dsh/storages/session_projcache/sessions/<会话 ID>.json` | 列表标题等缓存，顺带清掉避免残留 |
| 工作区归属 | `~/.dsh/storages/workspace.json` 里的 `sessionIds` | 通过插件调用 DSH 自己的 `detachSession` 完成 |
| 页面里的会话摘要 | 内存中 | 推送 `api-session/removed`，让已打开的页面即时移除这一行 |

**不会动的东西**：费用账本（`cost-meter` 的记账）、附件、设置、其它对话。

---

## 三、插件装在哪里（为什么更新删不掉它）

```
C:\Users\<你>\.dsh\plugins\dsh-conversation-delete
```

`~/.dsh` 是**用户数据目录**，不是应用安装目录。
DSH 的应用更新只会替换 `D:\Deepseek Harness\resources\app.asar` 这些程序文件，
不会碰 `~/.dsh` 下的插件与配置。

上次那个插件被删，是因为它的源码放在 `D:\Deepseek Harness\works\...`，
也就是**应用安装目录里面**，更新时整个目录被替换掉了。

当前配置（`~/.dsh/profiles/desktop/package.json`）里是一条指向上面的链接：

```json
"dsh-conversation-delete": "link:C:/Users/KIKIMORUA/.dsh/plugins/dsh-conversation-delete"
```

应用更新不会改动 profile 配置，所以这条链接会一直有效。

---

## 四、还会不会被误删？

| 情况 | 会不会删掉插件 | 说明 |
| --- | --- | --- |
| DSH 应用更新 | **不会** | 只替换安装目录，用户数据目录不动 |
| pnpm / 缓存清理 | **不会** | 源码在 `~/.dsh/plugins`，不在 pnpm 缓存里 |
| 在插件管理里「移除」这个 bundle | 只删配置，**源码还在** | 重新安装一次即可，见第五节 |
| 重装 DSH / 重置用户数据 / 手动清空 `~/.dsh` | **会** | 这属于把用户数据整个删掉 |
| 有完全文件权限的程序或 AI 直接删目录 | **会** | 任何文件都挡不住这种删除 |

为了第 4、5 种情况，已经在**文档目录另存了一份备份**：

```
C:\Users\KIKIMORUA\Documents\DSH插件备份\dsh-conversation-delete\   ← 插件文件备份
C:\Users\KIKIMORUA\Documents\DSH插件备份\恢复安装.cmd              ← 一键恢复
```

恢复方法：双击 `恢复安装.cmd`（它会问你要不要继续，按任意键即可），
它会把文件复制回 `~/.dsh/plugins/dsh-conversation-delete`，
然后再按第五节在 Harness 里重新安装一次。

另外提醒：**不要**把插件目录复制到 `D:\Deepseek Harness\` 里面去，
那样又会回到「更新即丢失」的老问题。

---

## 五、重新安装（换 profile 或恢复备份后）

方法一（推荐，在 Harness 会话里操作）：

```
plugin_manager → action: install_bundle
target: C:\Users\KIKIMORUA\.dsh\plugins\dsh-conversation-delete
```

方法二（命令行里 `dsh` 在 PATH 上时）：

```
dsh plugin --profile desktop add file:C:\Users\KIKIMORUA\.dsh\plugins\dsh-conversation-delete
```

装好后刷新一次网页（Ctrl+R）即可看到菜单项。

---

## 六、文件说明

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半区：删除逻辑 + 唯一的路由 `POST /plugin-conversation-delete/delete` |
| `client.js` | 网页半区：侧边栏菜单项和两次点击确认 |
| `cordis.patch.yml` | 把插件挂进 profile 的补丁 |
| `locale/zh.json`、`locale/en.json` | 插件管理里显示的名称和说明（中/英） |
| `icon.svg` | 插件图标 |
| `package.json` | 包声明（含 `dsh.bundle` 与 `dsh.client` 两段） |

---

## 七、安全设计

删除路由只接受满足下面条件的请求：

1. 必须是 `POST`；
2. 必须带自定义请求头 `x-dsh-conversation-delete: 1`
   （跨站请求带自定义头会先触发预检，而本路由不响应预检，所以外部网页调不动它）；
3. 如果带 `Origin`，必须和当前页面同源；
4. 会话 ID 必须符合 `session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 格式。

删除是幂等的：重复点、或在别处已经删过的对话再删一次，会安全返回而不会报错。

---

## 八、已知限制

- 菜单项的外观是按主题变量手写的，没有复用 DSH 内部的 UI 组件（那些组件会随版本变），
  所以样式有可能和新版界面有细微差别。
- 正在运行中的对话不允许删除，需要先停止。
- 删除不可撤销（没有回收站），确认前请看清楚标题。

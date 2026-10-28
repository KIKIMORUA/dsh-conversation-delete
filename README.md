# DSH 对话删除插件

在 DeepSeek Harness 网页版的侧边栏里，给每个对话的「…」菜单加一项 **删除对话**，
点两下就能把这个对话从本地真正删掉。

- 包名：`dsh-conversation-delete`
- 版本：1.0.0
- 仓库：<https://github.com/KIKIMORUA/dsh-conversation-delete>
- 纯 JavaScript，**无需构建**（没有 `prepare` / `install` 脚本），拉下来就能直接装

---

## 一、安装

### 方式 1：在 DSH 里直接从 GitHub 装（推荐）

打开 **设置 → 插件 → 安装**，在安装目标里填：

```
github:KIKIMORUA/dsh-conversation-delete
```

确认后 DSH 会自动下载并启用，**不需要重启**，最多刷新一次网页。

### 方式 2：命令行

```
dsh plugin --profile desktop add github:KIKIMORUA/dsh-conversation-delete
```

（`desktop` 换成你实际在用的 profile 名。）

### 方式 3：锁定某个提交

想固定版本、避免以后 `main` 变化影响你：

```
github:KIKIMORUA/dsh-conversation-delete#<commit-sha>
```

### 方式 4：本地源码目录（改代码时用）

```
plugin_manager → action: install_bundle
target: C:\Users\<你>\.dsh\plugins\dsh-conversation-delete
```

这样安装的是本地目录的**链接**，改完文件重载即生效；但装的不是 GitHub 上那份。

> **前置条件**
> - 仓库必须可访问；公开仓库不需要任何凭据。
> - 本机需要有 `git`：DSH 在安装前会用 `git ls-remote` 探活仓库（只是探测，不参与下载）。
> - 不需要预装 Node/pnpm，DSH 自带。

### 卸载

```
plugin_manager → action: remove_bundle
target: dsh-conversation-delete
```

或命令行 `dsh plugin --profile desktop remove dsh-conversation-delete`。

---

## 二、怎么用

1. 鼠标移到侧边栏任意对话上，点它右侧的「…」。
2. 菜单里选 **删除对话**（排在「复制会话 ID」后面）。
3. 菜单项会变成红色的「确认删除？不可恢复」，**6 秒内再点一次**才真的删。
4. 删除成功后对话立刻从列表消失，不需要刷新页面。

如果这个对话正在生成回复，会拒绝删除并提示「这个对话还在运行，请等本轮结束或先停止」，
等这一轮结束或点了停止之后再删即可。

---

## 三、删掉了什么

| 删除对象 | 位置 | 说明 |
| --- | --- | --- |
| 会话日志 | `~/.dsh/sessions/<项目目录>/<会话 ID>/` | 对话正文，删掉就没了 |
| 投影缓存 | `~/.dsh/storages/session_projcache/sessions/<会话 ID>.json` | 列表标题等缓存，顺带清掉避免残留 |
| 工作区归属 | `~/.dsh/storages/workspace.json` 里的 `sessionIds` | 通过 DSH 自己的 `detachSession` 完成 |
| 页面里的会话摘要 | 内存中 | 推送 `api-session/removed`，让已打开的页面即时移除这一行 |

**不会动的东西**：费用账本、附件、设置、其它对话。

---

## 四、装到哪里去了、怎么更新

从 GitHub 安装时，包会被复制到当前 profile 的依赖目录：

```
~/.dsh/profiles/<profile>/node_modules/dsh-conversation-delete
```

profile 的 `package.json` 里会记录这样一条：

```json
"dsh-conversation-delete": "github:KIKIMORUA/dsh-conversation-delete"
```

`~/.dsh` 是**用户数据目录**，DSH 应用更新只替换程序文件，不会删掉它，
所以升级 DSH 不会丢插件。想更新插件时，重新安装一遍同一个 spec 即可拉到
`main` 的最新提交；想回退就装回旧提交的 `#sha`。

---

## 五、安全设计

删除路由只接受满足下面条件的请求：

1. 必须是 `POST`；
2. 必须带自定义请求头 `x-dsh-conversation-delete: 1`
   （跨站请求带自定义头会先触发预检，而本路由不响应预检，外部网页调不动它）；
3. 如果带 `Origin`，必须和当前页面同源；
4. 会话 ID 必须符合 `session-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 格式。

删除是幂等的：重复点、或删一个已经不存在的对话，都会安全返回。
插件本身不联网、不上传任何数据，也不读取凭据。

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

## 七、开发

仓库没有构建步骤，改完 `index.js` / `client.js` 直接生效于「方式 4」的本地安装。
如果当前是「方式 1」的 GitHub 安装，本地改动**不会**进到 profile 里，
需要先切成本地安装，或者提交后重新安装。

提交前可以做个基本检查：

```
node --check index.js
node --check client.js
```

---

## 八、已知限制

- 菜单项外观按主题变量手写，没有复用 DSH 内部 UI 组件（那些会随版本变），
  所以样式可能和新版界面有细微差别。
- 正在运行中的对话不允许删除，需要先停止。
- 删除不可撤销（没有回收站），确认前请看清楚标题。
- 依赖 DSH 的这几个接口：菜单插入点 `sidebar.workspaces.session.menu.item`、
  `Workspace.detachSession`、`api-session/removed` 事件与 `session_projcache` 域；
  DSH 若改动它们，需要同步适配。

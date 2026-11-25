# Git Control (`agy-git`)

适用于 **Google Antigravity 2.0** 的原生右上角标题栏 Git 快捷插件。

## 主要功能

- **右上角标题栏原生入口**：通过本机 CDP 调试接口直接挂载在窗口右上角菜单旁，显示当前分支名与变更数量角标。
- **自动识别当前对话项目**：读取当前会话关联的 `gitRootAbsoluteUri` / `workspaceFolderAbsoluteUri`，切换对话时自动切换对应 Git 仓库。
- **变更管理（Changes）**：
  - 单文件 / 全部暂存（Stage）、取消暂存（Unstage）、二次确认放弃更改（Discard）
  - 点击文件直接预览 `git diff`
  - 编写提交消息（`Cmd/Ctrl + Enter` 快捷提交）、支持「提交已暂存」与「提交并 Push」
  - 集成 `Pull` / `Push` / `Fetch` 与分支切换 / 新建分支
- **AI 自动生成提交消息**：
  - 支持配置 OpenAI 兼容接口（自动适配 `/v1/responses`、`/v1/chat/completions`、`/v1/messages`，支持流式响应）
  - 支持自定义提交消息语言（简体中文 / English / 繁體中文 / 日本語 / 自动匹配）与改动范围（全部改动 / 仅已暂存改动）
- **历史回退（History）**：
  - 查看最近 50 条提交记录与 `git show --stat` 详情
  - 支持带二次确认的一键 `Soft` 回退、`Hard` 回退与 `Revert`
- **Tag 管理（Tags）**：
  - 支持创建轻量 Tag / 附注 Tag（可指定目标提交与创建后立即推送）
  - 支持单个 Tag 推送、推送全部 Tag 与删除本地 Tag

## 安装方法

### 方式一：发给 Agent 自动安装（推荐）

把下面这段话直接发给 Antigravity 或其他可执行本地命令的 Agent：

> 请帮我安装 Git Control (`agy-git`) 插件：https://github.com/Ryderwe/agy-git 。先克隆仓库到临时目录，阅读 README.md 后执行其中的安装脚本（或将插件文件复制到 `~/.gemini/config/plugins/agy-git`），保留其他插件、账户设置和聊天记录，不要强制退出当前客户端。安装完成后核对 `~/.gemini/config/plugins/agy-git/plugin.json` 版本并告诉我结果，需要重启时最后提醒我。

### 方式二：命令行安装

```bash
git clone https://github.com/Ryderwe/agy-git.git
cd agy-git
chmod +x install.sh && ./install.sh
```

> 依赖 Antigravity 调试端口（可配合 `agy-powertools` 自动带调试端口启动）。安装或更新后重启 Antigravity 即可生效。

# claude-zh

Claude Desktop 原生简体中文/繁体中文插件。一次安装后，Claude 的语言菜单里会有：

- English
- 简体中文
- 繁體中文

默认打开简体中文，也可以在 Claude 设置里的语言菜单切换到繁體中文或 English。

## 安装前准备

先安装两个东西：

1. Node.js
2. Git

安装 Node.js 后才会有 `node`、`npm`、`npx` 命令。
使用 `npx -y github:zoefix/claude-zh` 时，npm 需要调用 Git 下载 GitHub 仓库，所以也必须安装 Git。

检查是否安装成功：

```bash
node -v
npm -v
npx -v
git --version
```

如果这些命令有任何一个提示“找不到命令”，先重新安装 Node.js 或 Git。

下载地址：

- Node.js: https://nodejs.org/
- Git: https://git-scm.com/downloads

## 一键安装

关闭 Claude Desktop，然后执行：

```bash
npx -y github:zoefix/claude-zh
```

执行完成后，完全退出 Claude Desktop，再重新打开。

macOS 或 Linux 如果提示权限不足，把命令改成：

```bash
sudo npx -y github:zoefix/claude-zh
```

Windows 请使用“以管理员身份运行”的 PowerShell、CMD 或 Windows Terminal，再执行同一条命令：

```powershell
npx -y github:zoefix/claude-zh
```

## 切换语言

安装后打开 Claude：

```text
Settings > Appearance > Language
```

选择：

- `简体中文`
- `繁體中文`
- `English`

插件会隐藏 Claude 原本的 English 入口，并用自己的 `English` 入口保留原生英文显示，这样语言菜单不会出现两个 English。

## 恢复默认

想恢复官方原版：

```bash
npx -y github:zoefix/claude-zh default
```

macOS 或 Linux 如果提示权限不足：

```bash
sudo npx -y github:zoefix/claude-zh default
```

Windows 同样需要使用“以管理员身份运行”的终端。

## 找不到 Claude 怎么办

正常情况下插件会自动查找 Claude Desktop。

如果提示“没有自动找到 Claude Desktop”，手动指定 Claude 路径：

macOS：

```bash
sudo npx -y github:zoefix/claude-zh --app /Applications/Claude.app
```

Windows 普通安装版常见路径：

```powershell
npx -y github:zoefix/claude-zh --app "$env:LOCALAPPDATA\AnthropicClaude"
```

Windows Store / WindowsApps 版常见路径类似：

```text
C:\Program Files\WindowsApps\Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc\app
```

可以这样指定：

```powershell
npx -y github:zoefix/claude-zh --app "C:\Program Files\WindowsApps\Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc\app"
```

Linux 常见路径：

```bash
sudo npx -y github:zoefix/claude-zh --app /opt/Claude
```

## 高级用法

默认安装后会同时写入 English、简体中文、繁體中文。下面两个命令只决定首次打开时默认选中哪个中文：

```bash
# 默认简体中文
npx -y github:zoefix/claude-zh cn

# 默认繁體中文
npx -y github:zoefix/claude-zh tw
```

查看状态：

```bash
npx -y github:zoefix/claude-zh status
```

显示详细修改文件：

```bash
npx -y github:zoefix/claude-zh --verbose
```

## 常见问题

### npx 提示找不到 git

先安装 Git，然后重新打开终端再执行命令。

### Windows 提示权限不足

关闭当前窗口，右键 PowerShell、CMD 或 Windows Terminal，选择“以管理员身份运行”，再执行安装命令。

### macOS 已经 sudo 还是失败

到这里允许你运行命令的终端 App：

```text
系统设置 > 隐私与安全性 > App Management（应用管理）
```

如果还是失败，再把同一个终端 App 加到：

```text
系统设置 > 隐私与安全性 > Full Disk Access（完全磁盘访问）
```

### macOS 官方账号每次重启都要重新登录

请更新到最新版本插件后重新执行安装命令：

```bash
sudo npx -y github:zoefix/claude-zh
```

如果终端提示 `macOS 登录态修复需要输入当前 macOS 登录密码`，请输入你的 macOS 开机登录密码。这个步骤用于修复 Claude Helper 读取 Keychain 登录密钥的权限，输入后重新打开 Claude，再登录一次即可。

### Claude 更新后又变回英文

Claude 更新会覆盖本地插件。重新执行：

```bash
npx -y github:zoefix/claude-zh
```

### 安装后没有变化

确认已经完全退出 Claude Desktop。只关闭窗口不一定是真退出，需要从菜单栏或任务栏退出后重新打开。

## 备份位置

每次修改前都会自动备份。

- macOS: `~/Library/Application Support/claude-zh-cn/backups`
- Windows: `%APPDATA%\claude-zh-cn\backups`
- Linux: `~/.local/share/claude-zh-cn/backups`

## 本地开发

```bash
git clone https://github.com/zoefix/claude-zh.git
cd claude-zh
npm install
npm test
```

本地执行：

```bash
node src/cli.js --app /Applications/Claude.app
node src/cli.js tw --app /Applications/Claude.app
node src/cli.js default --app /Applications/Claude.app
```

## 说明

Claude Desktop 主界面会加载远程页面，只改本地 JSON 不够。本插件会修改 Claude 本地资源和 `app.asar`，并注入页面脚本处理动态界面文字。

macOS 修改 `app.asar` 后，插件会同步 `ElectronAsarIntegrity`，并对 `.app`、内部 helper、framework 和原生二进制做本机 ad-hoc 重签名，最后验证签名有效。同时会修复 `Claude Safe Storage` 的 Keychain 访问权限，避免官方账号重启后反复掉线。

Claude 新版本如果新增英文文案，可能需要继续补充翻译表。

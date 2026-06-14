#!/usr/bin/env node
"use strict";

const {
  DEFAULT_BACKUP_DIR,
  applyPatch,
  formatPermissionError,
  getStatus,
  launchPreview,
  restorePatch
} = require("./patcher");
const { normalizeLocale } = require("./translations");

const COMMANDS = new Set(["apply", "restore", "status", "preview"]);
const MODES = new Set(["cn", "tw", "default"]);

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }
  if (parsed.version) {
    console.log(require("../package.json").version);
    return 0;
  }

  try {
    if (parsed.command === "status") {
      return runStatus(parsed.options);
    }
    if (parsed.command === "restore") {
      return runRestore(parsed.options);
    }
    if (parsed.command === "default") {
      return runRestore({ ...parsed.options, restoreDefault: true });
    }
    if (parsed.command === "preview") {
      return runPreview(parsed.options);
    }
    return runApply(parsed.options);
  } catch (error) {
    console.error(formatPermissionError(error));
    return 1;
  }
}

function parseArgs(argv) {
  const result = {
    command: process.env.CLAUDE_ZH_DEFAULT_MODE === "default" ? "default" : "apply",
    options: {
      locale: defaultLocale()
    }
  };
  const args = [...argv];
  if (args[0] && MODES.has(args[0])) {
    const mode = args.shift();
    if (mode === "default") {
      result.command = "default";
    } else {
      result.command = "apply";
      result.options.locale = normalizeLocale(mode);
    }
  }
  if (args[0] && COMMANDS.has(args[0])) {
    result.command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--app") {
      result.options.app = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--locale" || arg === "--lang" || arg === "--language") {
      result.options.locale = normalizeLocale(readValue(args, index, arg));
      index += 1;
    } else if (arg === "--cn" || arg === "--zh-cn") {
      result.options.locale = "cn";
    } else if (arg === "--tw" || arg === "--zh-tw") {
      result.options.locale = "tw";
    } else if (arg === "--backup-dir") {
      result.options.backupDir = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--backup") {
      result.options.backup = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--preview-dir") {
      result.options.previewDir = readValue(args, index, arg);
      index += 1;
    } else if (arg === "--dry-run") {
      result.options.dryRun = true;
    } else if (arg === "--no-launch") {
      result.options.noLaunch = true;
    } else if (arg === "--shared-user-data") {
      result.options.sharedUserData = true;
    } else if (arg === "--yes" || arg === "-y") {
      result.options.yes = true;
    } else if (arg === "--verbose") {
      result.options.verbose = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return result;
}

function defaultLocale() {
  const mode = process.env.CLAUDE_ZH_DEFAULT_MODE || require("../package.json").claudeZhDefaultMode || "cn";
  if (mode === "default") return "cn";
  return normalizeLocale(mode);
}

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个路径`);
  return value;
}

function runApply(options) {
  const result = applyPatch(options);
  const changedCount = result.changes.length;
  const installedLanguages = "English / 简体中文 / 繁體中文";
  if (result.windowsAppsInPlace) {
    console.log(result.launched ? "WindowsApps 版插件已安装并启动。" : "WindowsApps 版插件已安装。");
    console.log(`默认语言: ${result.lang}`);
    console.log(`语言菜单: ${installedLanguages}`);
    console.log(`Claude: ${result.appPath}`);
    console.log(`资源目录: ${result.resourcesPath}`);
    console.log(`备份目录: ${result.backupPath}`);
    if (result.unlock) console.log(`接管权限: ${result.unlock.ok ? "成功" : "失败"}`);
    if (result.packageFamilyName) console.log(`包身份: ${result.packageFamilyName}`);
    if (result.appUserModelId) console.log(`AppUserModelId: ${result.appUserModelId}`);
    if (result.launcherPath) console.log(`启动器: ${result.launcherPath}`);
    console.log(`修改数量: ${changedCount}`);
    if (result.pid) console.log(`进程 PID: ${result.pid}`);
    if (options.verbose && changedCount) printList(result.changes);
    console.log("恢复默认可执行 default。");
    return 0;
  }
  console.log(options.dryRun ? "演练完成，未修改文件。" : "插件安装完成。");
  console.log(`默认语言: ${result.lang}`);
  console.log(`语言菜单: ${installedLanguages}`);
  console.log(`Claude: ${result.appPath}`);
  console.log(`资源目录: ${result.resourcesPath}`);
  console.log(`备份目录: ${result.backupPath}`);
  console.log(`修改数量: ${changedCount}`);
  if (options.verbose && changedCount) printList(result.changes);
  if (!options.dryRun) console.log("请完全退出并重新打开 Claude。");
  return 0;
}

function runPreview(options) {
  const result = launchPreview(options);
  const changedCount = result.changes.length;
  if (result.dryRun) {
    console.log("演练完成，未创建临时副本。");
  } else {
    console.log(result.launched ? "临时插件版已启动。" : "临时插件版已准备。");
  }
  console.log(`原版 Claude: ${result.sourceAppPath}`);
  console.log(`临时 Claude: ${result.previewAppPath}`);
  if (result.lang) console.log(`语言: ${result.lang}`);
  console.log(`临时数据目录: ${result.userDataDir || "使用原 Claude 数据"}`);
  console.log(`备份目录: ${result.backupPath}`);
  console.log(`修改数量: ${changedCount}`);
  if (result.pid) console.log(`进程 PID: ${result.pid}`);
  if (options.verbose && changedCount) printList(result.changes);
  if (!result.dryRun) {
    console.log("原版 Claude 未被修改。");
    if (result.userDataDir) console.log("临时版使用独立登录数据，首次打开可能需要重新登录。");
  }
  return 0;
}

function runRestore(options) {
  const result = restorePatch(options);
  console.log(options.dryRun ? "演练完成，未恢复文件。" : "恢复完成。");
  if (result.restoreDefault) console.log("模式: 恢复默认");
  console.log(`Claude: ${result.appPath}`);
  console.log(`资源目录: ${result.resourcesPath}`);
  console.log(`备份目录: ${result.backupPath}`);
  if (result.windowsAppsRegistrationRestore) {
    if (result.unlock) console.log(`接管权限: ${result.unlock.ok ? "成功" : "失败"}`);
    if (result.managedPackageFamilyName) console.log(`移除包身份: ${result.managedPackageFamilyName}`);
    if (result.unregister) console.log(`移除状态: ${result.unregister.ok ? "成功" : "失败"}`);
    if (result.packageFamilyName) console.log(`原版包身份: ${result.packageFamilyName}`);
    if (result.registration) console.log(`原版注册: ${result.registration.ok ? "成功" : "失败"}`);
    if (result.registration && !result.registration.ok) console.log(`注册信息: ${result.registration.message}`);
  }
  console.log(`恢复数量: ${result.restored.length}`);
  if (options.verbose && result.restored.length) printList(result.restored);
  if (!options.dryRun) console.log("请完全退出并重新打开 Claude。");
  return result.registration && !result.registration.ok ? 1 : 0;
}

function runStatus(options) {
  const rows = getStatus(options);
  if (!rows.length) {
    console.log("没有自动找到 Claude Desktop。可以用 --app 指定安装目录。");
    console.log(`默认备份目录: ${DEFAULT_BACKUP_DIR}`);
    return 1;
  }

  for (const row of rows) {
    console.log(`Claude: ${row.appPath}`);
    if (row.error) {
      console.log(`状态: ${row.error}`);
      continue;
    }
    console.log(`资源目录: ${row.resourcesPath}`);
    console.log(`目标语言: ${row.lang}`);
    console.log(`状态: ${formatStatus(row)}`);
    console.log(`最近备份: ${row.backupPath || "无"}`);
  }
  return 0;
}

function formatStatus(row) {
  if (row.patchState?.needsPreloadUpgrade) return "需要更新主界面插件（请重新执行安装命令）";
  if (row.patchState?.partial) return "插件未完整安装（请重新执行安装命令）";
  return row.patched ? "插件已安装" : "未安装";
}

function printList(items) {
  for (const item of items) console.log(`- ${item}`);
}

function printHelp() {
  const bin = "claude-zh";
  console.log(`Claude Desktop 原生简体中文/繁体中文插件

用法:
  ${bin} [选项]
  ${bin} cn [选项]       默认打开简体中文
  ${bin} tw [选项]       默认打开繁體中文
  ${bin} default [选项]
  ${bin} preview [选项]
  ${bin} status [选项]
  ${bin} restore [选项]

选项:
  --app <路径>          指定 Claude.app、Claude 安装目录或 resources 目录
  --locale <cn|tw>      指定默认打开简体中文或台湾繁体中文
  --backup-dir <路径>   指定备份保存目录
  --backup <路径>       restore 时指定某一次备份目录
  --preview-dir <路径>  preview 时指定临时副本目录
  --no-launch           preview 或 WindowsApps 版只准备，不启动
  --shared-user-data    preview 时使用原 Claude 登录数据
  --dry-run             只显示结果，不写入文件
  -y, --yes             直接执行，保留给自动化脚本使用
  --verbose             显示修改文件列表
  -h, --help            显示帮助
  -v, --version         显示版本

默认备份目录:
  ${DEFAULT_BACKUP_DIR}`);
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  main,
  parseArgs
};

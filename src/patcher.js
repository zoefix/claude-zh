"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");
const {
  ALL_PHRASES,
  COMPOUND_PHRASES,
  createCatalog,
  normalizeLocale
} = require("./translations");

const MARKER = "claude-zh-cn";
const PRELOAD_MARKER_PREFIX = "claude-zh-cn preload patch";
const PRELOAD_MARKER_VERSION = "v28";
const CURRENT_PRELOAD_MARKER = `${PRELOAD_MARKER_PREFIX} ${PRELOAD_MARKER_VERSION}`;
const DEFAULT_BACKUP_DIR = path.join(appDataDir(), "backups");
const MANAGED_WINDOWS_APP_NAME = "Claude";
const WINDOWS_SHORTCUT_NAME = "Claude CN";
const MANAGED_WINDOWS_PACKAGE_SUFFIX = "CN";

function appDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "claude-zh-cn");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/claude-zh-cn");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "claude-zh-cn");
}

function localAppDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), "claude-zh-cn");
  }
  return appDataDir();
}

function detectCandidates() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push("/Applications/Claude.app", path.join(home, "Applications/Claude.app"));
  } else if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "AnthropicClaude"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Claude"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Claude Desktop"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Anthropic Claude"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Claude"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Claude Desktop"),
      process.env.APPDATA && path.join(process.env.APPDATA, "Claude"),
      process.env.APPDATA && path.join(process.env.APPDATA, "Claude Desktop"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Claude"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Claude Desktop"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Anthropic/Claude"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Anthropic Claude"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Claude"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Claude Desktop"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Anthropic/Claude"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Anthropic Claude")
    ].filter(Boolean);
    for (const root of roots) candidates.push(root, path.join(root, "resources"));
    for (const appxLocation of findInstalledWindowsAppxClaudeLocations()) {
      candidates.push(appxLocation, path.join(appxLocation, "app"), path.join(appxLocation, "app", "resources"));
    }
    const windowsAppsRoot = process.env.ProgramFiles && path.join(process.env.ProgramFiles, "WindowsApps");
    for (const packageRoot of findWindowsAppsClaudePackages(windowsAppsRoot)) {
      candidates.push(packageRoot);
    }
  } else {
    candidates.push(
      path.join(home, ".local/share/Claude"),
      path.join(home, ".local/share/Claude/resources"),
      path.join(home, ".local/share/claude"),
      path.join(home, ".local/share/claude/resources"),
      path.join(home, "Applications/Claude"),
      path.join(home, "Applications/Claude/resources"),
      "/opt/Claude",
      "/opt/claude",
      "/opt/Claude/resources",
      "/opt/claude/resources",
      "/usr/share/Claude",
      "/usr/share/Claude/resources",
      "/usr/share/claude",
      "/usr/share/claude/resources",
      "/usr/lib/claude",
      "/usr/lib/claude/resources",
      "/usr/lib/Claude",
      "/usr/lib/Claude/resources"
    );
  }

  return [...new Set(candidates)].filter((candidate) => {
    try {
      return fs.existsSync(candidate) && resolveInstall(candidate);
    } catch {
      return false;
    }
  });
}

function resolveInstall(inputPath) {
  const input = normalizeInstallInput(inputPath);
  const checks = installResourceCandidates(input);

  for (const resourcesPath of checks) {
    if (isResourcesDir(resourcesPath)) {
      return {
        appPath: inferAppPath(input, resourcesPath),
        resourcesPath
      };
    }
  }

  throw new Error(`找不到 Claude Desktop 资源目录：${input}`);
}

function normalizeInstallInput(inputPath) {
  const input = path.resolve(inputPath);
  if (safeIsFile(input) && path.extname(input).toLowerCase() === ".exe") return path.dirname(input);
  return input;
}

function installResourceCandidates(input) {
  const checks = [];
  checks.push(input);
  checks.push(path.join(input, "resources"));
  checks.push(path.join(input, "Resources"));
  checks.push(path.join(input, "Contents/Resources"));
  checks.push(path.join(input, "app"));
  checks.push(path.join(input, "App"));
  checks.push(path.join(input, "app", "resources"));
  checks.push(path.join(input, "app", "Resources"));
  checks.push(path.join(input, "App", "resources"));
  checks.push(path.join(input, "App", "Resources"));
  for (const appDir of versionedAppDirs(input)) {
    checks.push(appDir);
    checks.push(path.join(appDir, "resources"));
    checks.push(path.join(appDir, "Resources"));
  }
  return [...new Set(checks)];
}

function inferAppPath(input, resourcesPath) {
  if (process.platform === "darwin" && resourcesPath.endsWith(path.join("Contents", "Resources"))) {
    return path.dirname(path.dirname(resourcesPath));
  }
  if (path.basename(resourcesPath).toLowerCase() === "resources") return path.dirname(resourcesPath);
  return input;
}

function versionedAppDirs(root) {
  if (!safeIsDirectory(root)) return [];
  return safeReadDir(root)
    .filter((name) => /^app-\d/i.test(name))
    .map((name) => path.join(root, name))
    .filter((candidate) => safeIsDirectory(candidate))
    .sort((a, b) => compareAppDirVersions(b, a));
}

function compareAppDirVersions(left, right) {
  const leftVersion = versionPartsFromAppDir(left);
  const rightVersion = versionPartsFromAppDir(right);
  const length = Math.max(leftVersion.length, rightVersion.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftVersion[index] || 0) - (rightVersion[index] || 0);
    if (diff) return diff;
  }
  return path.basename(left).localeCompare(path.basename(right));
}

function versionPartsFromAppDir(dir) {
  const match = path.basename(dir).match(/^app-(\d+(?:\.\d+)*)/i);
  return match ? match[1].split(".").map((part) => Number(part) || 0) : [];
}

function findWindowsAppsClaudePackages(windowsAppsRoot) {
  if (!safeIsDirectory(windowsAppsRoot)) return [];
  return safeReadDir(windowsAppsRoot)
    .filter((name) => /^Claude_/i.test(name))
    .map((name) => path.join(windowsAppsRoot, name))
    .filter((candidate) => safeIsDirectory(candidate))
    .sort((a, b) => String(b).localeCompare(String(a)));
}

function findInstalledWindowsAppxClaudeLocations() {
  if (process.platform !== "win32") return [];
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      "$packages = @(Get-AppxPackage -Name 'Claude' -ErrorAction SilentlyContinue)",
      "$packages | Where-Object { $_.InstallLocation } | Sort-Object InstallLocation -Descending | Select-Object -ExpandProperty InstallLocation | ConvertTo-Json -Compress"
    ].join("; ")
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
  } catch {
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
}

function isResourcesDir(dir) {
  return (
    safeIsDirectory(dir) &&
    (
      fs.existsSync(path.join(dir, "app.asar")) ||
      fs.existsSync(path.join(dir, "en-US.json")) ||
      fs.existsSync(path.join(dir, "ion-dist"))
    )
  );
}

function safeIsDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function assertWritableResources(resourcesPath) {
  const probe = path.join(resourcesPath, `.claude-zh-cn-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (error) {
    safeUnlink(probe);
    error.claudeZhCnPath = resourcesPath;
    throw error;
  }
}

function applyPatch(options = {}) {
  const install = resolveInstall(options.app || firstDetectedApp());
  if (!options.dryRun && shouldPatchWindowsAppsInPlace(install, options)) {
    return applyPatchToWindowsAppsInPlace(install, options);
  }
  return applyPatchInPlace(install, options);
}

function applyPatchInPlace(install, options = {}) {
  if (!options.dryRun) assertWritableResources(install.resourcesPath);
  const catalog = createCatalog({ locale: options.locale || options.lang || "cn" });
  const languageCatalogs = allLanguageCatalogs(catalog);
  const backup = createBackup(install, options);
  const changes = [];

  patchRootMessages(install.resourcesPath, backup, changes, options, catalog, languageCatalogs);
  patchLocalizableStrings(install.resourcesPath, backup, changes, options, catalog, languageCatalogs);
  patchIonDist(install.resourcesPath, backup, changes, options, catalog, languageCatalogs);
  patchAsarPreload(install.resourcesPath, backup, changes, options, catalog);
  const macCodeSign = repairMacAppSignature(install, backup, changes, options);

  if (!options.dryRun) {
    writeManifest(backup, install, changes, catalog, languageCatalogs);
  }

  return {
    appPath: install.appPath,
    resourcesPath: install.resourcesPath,
    backupPath: backup.path,
    locale: catalog.locale,
    lang: catalog.lang,
    languages: languageCatalogs.map((entry) => entry.lang),
    dryRun: Boolean(options.dryRun),
    macCodeSign,
    changes
  };
}

function allLanguageCatalogs(primaryCatalog) {
  const locales = [primaryCatalog.locale, ...["cn", "tw"].filter((locale) => locale !== primaryCatalog.locale)];
  return locales.map((locale) => (locale === primaryCatalog.locale ? primaryCatalog : createCatalog({ locale })));
}

function shouldPatchWindowsAppsInPlace(install, options = {}) {
  if (options.forceWindowsAppsInPlace) return true;
  if (options.disableWindowsAppsInPlace) return false;
  return process.platform === "win32" && isWindowsAppsPath(install.appPath);
}

function applyPatchToWindowsAppsInPlace(install, options = {}) {
  if (!options.skipClose) closeClaudeOnWindows();
  const unlock = unlockWindowsAppsInstall(install.appPath);
  const patchResult = applyPatchInPlace(install, options);
  const launchInfo = getWindowsAppsLaunchInfo(install.appPath);
  const launcherPath = process.platform === "win32" && launchInfo?.appUserModelId
    ? createWindowsLauncher(install.appPath, getManagedWindowsRoot(options), {
      appUserModelId: launchInfo.appUserModelId
    })
    : null;
  const launch = options.noLaunch ? null : launchManagedWindowsApp(install.appPath, launcherPath);

  return {
    ...patchResult,
    windowsAppsInPlace: true,
    unlock,
    packageFamilyName: launchInfo?.packageFamilyName || null,
    appUserModelId: launchInfo?.appUserModelId || null,
    launcherPath,
    launched: Boolean(launch && launch.ok !== false),
    pid: launch?.pid || null
  };
}

function restorePatch(options = {}) {
  const sourceInstall = resolveInstall(options.app || firstDetectedApp());
  if (!options.dryRun && options.restoreDefault && shouldRestoreWindowsAppsRegistration(sourceInstall, options)) {
    return restoreWindowsAppsInPlace(sourceInstall, options);
  }
  const install = resolveRestoreInstall(sourceInstall, options);
  return restorePatchForInstall(install, options);
}

function restorePatchForInstall(install, options = {}) {
  const backupPath = options.backup
    ? path.resolve(options.backup)
    : findBackup(install.resourcesPath, options.backupDir, "latest");
  if (!backupPath) throw new Error("没有找到可用备份。请用 --backup 指定备份目录。");

  const backupPaths = options.restoreDefault && !options.backup
    ? listBackups(install.resourcesPath, options.backupDir).map((entry) => entry.path)
    : [backupPath];
  const restored = [];

  for (const currentBackupPath of backupPaths) {
    const manifest = readJson(path.join(currentBackupPath, "manifest.json"));
    restoreManifestFiles(install, currentBackupPath, manifest, restored, options);
  }
  const macCodeSign = repairMacAppSignature(install, null, restored, options);

  return {
    appPath: install.appPath,
    resourcesPath: install.resourcesPath,
    backupPath: backupPaths[backupPaths.length - 1],
    restoreDefault: Boolean(options.restoreDefault),
    dryRun: Boolean(options.dryRun),
    macCodeSign,
    restored
  };
}

function resolveRestoreInstall(sourceInstall, options = {}) {
  if (!shouldPatchWindowsAppsInPlace(sourceInstall, options)) return sourceInstall;
  for (const managedAppPath of getManagedWindowsAppPathCandidates(sourceInstall.appPath, options)) {
    if (safeIsDirectory(managedAppPath)) return resolveInstall(managedAppPath);
  }
  return sourceInstall;
}

function shouldRestoreWindowsAppsRegistration(sourceInstall, options = {}) {
  return (
    process.platform === "win32" &&
    isWindowsAppsPath(sourceInstall.appPath) &&
    !options.backup &&
    !options.skipWindowsAppsRegistrationRestore
  );
}

function restoreWindowsAppsInPlace(sourceInstall, options = {}) {
  let restored = [];
  const unlock = unlockWindowsAppsInstall(sourceInstall.appPath);
  const restoreInstalls = uniqueInstalls([sourceInstall, resolveRestoreInstall(sourceInstall, options)]);
  for (const restoreInstall of restoreInstalls) {
    if (!safeIsDirectory(restoreInstall.resourcesPath)) continue;
    try {
      const result = restorePatchForInstall(restoreInstall, {
        ...options,
        restoreDefault: true,
        skipWindowsAppsRegistrationRestore: true
      });
      restored = restored.concat(result.restored);
    } catch (error) {
      if (!/没有找到可用备份/.test(error.message)) throw error;
    }
  }
  const sourcePackageRoot = windowsAppsPackageRoot(sourceInstall.appPath);
  const sourcePackageFullName = sourcePackageRoot ? path.basename(sourcePackageRoot) : null;
  const packageFamilyName = sourcePackageFullName ? packageFamilyNameFromFullName(sourcePackageFullName) : null;
  const managedPackageFamilyName = managedWindowsPackageFamilyNameFromFullName(sourcePackageFullName);
  const managedCopyPaths = getManagedWindowsAppPathCandidates(sourceInstall.appPath, options);
  const sourceRegistration = packageFamilyName ? getWindowsPackageRegistration(packageFamilyName) : null;

  closeClaudeOnWindows();
  const unregisterManaged = managedPackageFamilyName ? unregisterWindowsPackage(managedPackageFamilyName) : null;
  const unregisterSwitchedSource = sourceRegistration && managedCopyPaths.some((managedCopyPath) => sameWindowsPath(sourceRegistration.InstallLocation, managedCopyPath))
    ? unregisterWindowsPackage(packageFamilyName)
    : null;

  return {
    appPath: sourceInstall.appPath,
    resourcesPath: sourceInstall.resourcesPath,
    backupPath: null,
    restoreDefault: true,
    dryRun: false,
    restored,
    windowsAppsRegistrationRestore: true,
    windowsAppsInPlaceRestore: true,
    unregister: unregisterManaged,
    unregisterSwitchedSource,
    registration: null,
    unlock,
    packageFamilyName,
    managedPackageFamilyName
  };
}

function uniqueInstalls(installs) {
  const seen = new Set();
  const output = [];
  for (const install of installs) {
    if (!install || !install.resourcesPath) continue;
    const key = path.resolve(install.resourcesPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(install);
  }
  return output;
}

function restoreManifestFiles(install, backupPath, manifest, restored, options) {
  for (const entry of manifest.files) {
    const target = path.join(install.resourcesPath, entry.relativePath);
    const label = options.backup || !options.restoreDefault ? entry.relativePath : `${path.basename(backupPath)}/${entry.relativePath}`;
    if (options.dryRun) {
      restored.push(label);
      continue;
    }
    if (entry.existed) {
      ensureDir(path.dirname(target));
      fs.copyFileSync(path.join(backupPath, entry.backupName), target);
    } else {
      safeUnlink(target);
      pruneEmptyDirs(path.dirname(target), install.resourcesPath);
    }
    restored.push(label);
  }
}

function launchPreview(options = {}) {
  const sourceInstall = resolveInstall(options.app || firstDetectedApp());
  const previewRoot = path.resolve(options.previewDir || path.join(appDataDir(), "preview"));
  const previewAppPath = getPreviewAppPath(sourceInstall.appPath, previewRoot);

  if (options.dryRun) {
    return {
      sourceAppPath: sourceInstall.appPath,
      previewAppPath,
      userDataDir: options.sharedUserData ? null : path.join(previewRoot, "user-data"),
      backupPath: path.join(previewRoot, "backups"),
      dryRun: true,
      launched: false,
      changes: []
    };
  }

  copyInstallForPreview(sourceInstall.appPath, previewAppPath);
  const patchResult = applyPatch({
    ...options,
    app: previewAppPath,
    backupDir: path.join(previewRoot, "backups"),
    dryRun: false
  });
  const userDataDir = options.sharedUserData ? null : path.join(previewRoot, "user-data");
  if (userDataDir) ensureDir(userDataDir);

  let launch = null;
  if (!options.noLaunch) {
    launch = launchApp(previewAppPath, { userDataDir });
  }

  return {
    sourceAppPath: sourceInstall.appPath,
    previewAppPath,
    resourcesPath: patchResult.resourcesPath,
    backupPath: patchResult.backupPath,
    locale: patchResult.locale,
    lang: patchResult.lang,
    userDataDir,
    dryRun: false,
    launched: !options.noLaunch,
    pid: launch?.pid || null,
    changes: patchResult.changes
  };
}

function getStatus(options = {}) {
  const catalog = createCatalog({ locale: options.locale || options.lang || "cn" });
  const candidates = options.app ? [options.app] : detectCandidates();
  return candidates.map((candidate) => {
    try {
      const install = resolveInstall(candidate);
      const patchState = getPatchState(install.resourcesPath, catalog);
      return {
        appPath: install.appPath,
        resourcesPath: install.resourcesPath,
        locale: catalog.locale,
        lang: catalog.lang,
        patched: patchState.patched,
        patchState,
        backupPath: findBackup(install.resourcesPath, options.backupDir, "latest")
      };
    } catch (error) {
      return {
        appPath: candidate,
        error: error.message
      };
    }
  });
}

function firstDetectedApp() {
  const candidates = detectCandidates();
  if (!candidates.length) {
    throw new Error(noClaudeDetectedMessage());
  }
  return candidates[0];
}

function noClaudeDetectedMessage() {
  if (process.platform === "win32") {
    return [
      "没有自动找到 Claude Desktop。请用 --app 指定安装目录。",
      "Windows 常见路径：%LOCALAPPDATA%\\AnthropicClaude",
      "Windows Store 版会自动尝试 Get-AppxPackage -Name Claude。",
      "CMD 示例：npx -y github:zoefix/claude-zh --app \"%LOCALAPPDATA%\\AnthropicClaude\"",
      "也可以把 Claude.exe 的完整路径传给 --app。"
    ].join("\n");
  }
  return "没有自动找到 Claude Desktop。请用 --app 指定安装目录。";
}

function getPreviewAppPath(sourceAppPath, previewRoot) {
  const sourceName = path.basename(sourceAppPath.replace(/[\\/]+$/, "")) || "Claude";
  return path.join(previewRoot, sourceName);
}

function copyInstallForPreview(sourceAppPath, previewAppPath) {
  const source = path.resolve(sourceAppPath);
  const target = path.resolve(previewAppPath);
  if (source === target) {
    throw new Error("临时副本目录不能和原版 Claude 目录相同。请用 --preview-dir 指定其他目录。");
  }
  if (!safeIsDirectory(source)) {
    throw new Error("preview 需要 Claude 安装目录，不能只传 resources 目录。请用 --app 指向 Claude.app 或安装目录。");
  }

  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(path.dirname(target));
  copyDirectory(source, target);
}

function copyInstallForManagedWindows(sourceAppPath, managedAppPath) {
  const source = path.resolve(windowsAppsPackageRoot(sourceAppPath) || sourceAppPath);
  const target = path.resolve(managedAppPath);
  if (source === target) return;
  copyInstallForPreview(source, target);
  makeWritableTree(target);
}

function copyDirectory(source, target) {
  if (process.platform === "darwin" && source.endsWith(".app")) {
    const result = childProcess.spawnSync("ditto", [source, target], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.status === 0) return;
  }
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    verbatimSymlinks: true
  });
}

function makeWritableTree(root) {
  if (!safeIsDirectory(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    try {
      const stat = fs.statSync(current);
      fs.chmodSync(current, stat.isDirectory() ? 0o755 : 0o644);
      if (stat.isDirectory()) {
        for (const name of safeReadDir(current)) stack.push(path.join(current, name));
      }
    } catch {
      // Best effort: copied package files may include entries the current user cannot chmod.
    }
  }
}

function launchApp(appPath, options = {}) {
  const command = findLaunchExecutable(appPath);
  const env = {
    ...process.env,
    CLAUDE_ZH_CN_PREVIEW: "1",
    LANG: process.env.LANG || "zh_CN.UTF-8"
  };
  if (options.userDataDir) env.CLAUDE_USER_DATA_DIR = options.userDataDir;

  const child = childProcess.spawn(command, [], {
    cwd: path.dirname(command),
    detached: true,
    stdio: "ignore",
    env
  });
  child.unref();
  return { pid: child.pid, command };
}

function getManagedWindowsRoot(options = {}) {
  return path.resolve(options.managedDir || path.join(localAppDataDir(), "managed"));
}

function getManagedWindowsAppPath(options = {}) {
  return path.join(getManagedWindowsRoot(options), MANAGED_WINDOWS_APP_NAME);
}

function getManagedWindowsAppPathCandidates(sourceAppPath = null, options = {}) {
  if (options.managedDir || !sourceAppPath) return [getManagedWindowsAppPath(options)];

  const sourcePackageRoot = windowsAppsPackageRoot(sourceAppPath);
  const sourcePackageFullName = sourcePackageRoot ? path.basename(sourcePackageRoot) : null;
  const managedFamilyName = managedWindowsPackageFamilyNameFromFullName(sourcePackageFullName);
  const managedFullName = managedWindowsPackageFullNameFromFullName(sourcePackageFullName);
  const candidates = [];

  if (process.platform === "win32" && managedFamilyName && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Packages", managedFamilyName));
  }
  if (process.platform === "win32" && managedFullName && process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, "WindowsApps-Import", managedFullName));
  }
  candidates.push(getManagedWindowsAppPath(options));
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function isWindowsAppsPath(file) {
  return path.resolve(file).toLowerCase().split(/[\\/]+/).includes("windowsapps");
}

function windowsAppsPackageRoot(file) {
  const resolved = path.resolve(file);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(/[\\/]+/).filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === "windowsapps");
  if (index === -1 || !parts[index + 1]) return null;
  if (!/^Claude_/i.test(parts[index + 1])) return null;
  return path.join(root, ...parts.slice(0, index + 2));
}

function windowsManagedPackageFamilyNameForSource(sourceAppPath) {
  const sourcePackageRoot = windowsAppsPackageRoot(sourceAppPath);
  const sourcePackageFullName = sourcePackageRoot ? path.basename(sourcePackageRoot) : null;
  return managedWindowsPackageFamilyNameFromFullName(sourcePackageFullName);
}

function getWindowsAppsLaunchInfo(sourceAppPath) {
  const sourceRoot = windowsAppsPackageRoot(sourceAppPath);
  const sourcePackageFullName = sourceRoot ? path.basename(sourceRoot) : null;
  const packageFamilyName = sourcePackageFullName ? packageFamilyNameFromFullName(sourcePackageFullName) : null;
  const manifestPath = sourceRoot ? path.join(sourceRoot, "AppxManifest.xml") : path.join(sourceAppPath, "AppxManifest.xml");
  const applicationId = readWindowsApplicationId(manifestPath) || "Claude";
  return {
    packageFamilyName,
    applicationId,
    appUserModelId: packageFamilyName ? `${packageFamilyName}!${applicationId}` : null
  };
}

function prepareManagedWindowsPackageManifest(sourceAppPath, managedCopyPath) {
  const sourceRoot = windowsAppsPackageRoot(sourceAppPath);
  const sourcePackageFullName = sourceRoot ? path.basename(sourceRoot) : null;
  const sourcePackageFamilyName = sourcePackageFullName ? packageFamilyNameFromFullName(sourcePackageFullName) : null;
  const managedPackageName = managedWindowsPackageNameFromFullName(sourcePackageFullName);
  const packageFamilyName = managedWindowsPackageFamilyNameFromFullName(sourcePackageFullName) || sourcePackageFamilyName;
  const manifestPath = path.join(managedCopyPath, "AppxManifest.xml");
  const applicationId = readWindowsApplicationId(manifestPath) || "App";

  if (managedPackageName && fs.existsSync(manifestPath)) {
    const manifest = fs.readFileSync(manifestPath, "utf8");
    const patched = patchWindowsManifestForManagedPackage(manifest, managedPackageName);
    if (patched !== manifest) fs.writeFileSync(manifestPath, patched, "utf8");
  }

  return {
    sourcePackageFamilyName,
    packageFamilyName,
    applicationId,
    appUserModelId: packageFamilyName ? `${packageFamilyName}!${applicationId}` : null
  };
}

function packageFamilyNameFromFullName(packageFullName) {
  const packageName = packageNameFromFullName(packageFullName);
  const publisherId = publisherIdFromFullName(packageFullName);
  if (!packageName || !publisherId) return null;
  return `${packageName}_${publisherId}`;
}

function managedWindowsPackageNameFromFullName(packageFullName) {
  const packageName = packageNameFromFullName(packageFullName);
  if (!packageName) return null;
  return packageName.endsWith(MANAGED_WINDOWS_PACKAGE_SUFFIX)
    ? packageName
    : `${packageName}${MANAGED_WINDOWS_PACKAGE_SUFFIX}`;
}

function managedWindowsPackageFullNameFromFullName(packageFullName) {
  const [left, publisherId] = String(packageFullName || "").split("__");
  const packageName = managedWindowsPackageNameFromFullName(packageFullName);
  if (!left || !publisherId || !packageName) return null;
  const parts = left.split("_");
  const versionIndex = parts.findIndex((part) => /^\d+(?:\.\d+){1,3}$/.test(part));
  if (versionIndex <= 0) return null;
  return `${[packageName, ...parts.slice(versionIndex)].join("_")}__${publisherId}`;
}

function managedWindowsPackageFamilyNameFromFullName(packageFullName) {
  const packageName = managedWindowsPackageNameFromFullName(packageFullName);
  const publisherId = publisherIdFromFullName(packageFullName);
  if (!packageName || !publisherId) return null;
  return `${packageName}_${publisherId}`;
}

function packageNameFromFullName(packageFullName) {
  const [left] = String(packageFullName || "").split("__");
  if (!left) return null;
  const parts = left.split("_");
  const versionIndex = parts.findIndex((part) => /^\d+(?:\.\d+){1,3}$/.test(part));
  if (versionIndex <= 0) return null;
  return parts.slice(0, versionIndex).join("_");
}

function publisherIdFromFullName(packageFullName) {
  const [, publisherId] = String(packageFullName || "").split("__");
  return publisherId || null;
}

function patchWindowsManifestForManagedPackage(manifest, packageName) {
  let output = manifest;
  output = output.replace(/(<Identity\b[^>]*\bName=")([^"]+)(")/i, `$1${packageName}$3`);
  output = output.replace(/(<Properties\b[\s\S]*?<DisplayName>)([\s\S]*?)(<\/DisplayName>)/i, `$1${WINDOWS_SHORTCUT_NAME}$3`);
  output = output.replace(/(<Properties\b[\s\S]*?<Description>)([\s\S]*?)(<\/Description>)/i, `$1${WINDOWS_SHORTCUT_NAME}$3`);
  output = output.replace(/(<(?:\w+:)?VisualElements\b[^>]*\bDisplayName=")([^"]+)(")/i, `$1${WINDOWS_SHORTCUT_NAME}$3`);
  output = output.replace(/(<(?:\w+:)?VisualElements\b[^>]*\bDescription=")([^"]+)(")/i, `$1${WINDOWS_SHORTCUT_NAME}$3`);
  return output;
}

function readWindowsApplicationId(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const match = manifest.match(/<Application\b[^>]*\bId="([^"]+)"/i);
  return match ? match[1] : null;
}

function registerManagedWindowsPackage(managedCopyPath, launchInfo = {}) {
  return registerWindowsPackageAtPath(managedCopyPath, {
    packageFamilyName: launchInfo?.packageFamilyName,
    disableDevelopmentModeFirst: false,
    unregisterExistingDifferentLocation: true
  });
}

function registerWindowsPackageAtPath(packageRoot, options = {}) {
  if (process.platform !== "win32") return null;
  const manifestPath = path.join(packageRoot, "AppxManifest.xml");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, manifestPath, message: "缺少 AppxManifest.xml，无法注册 WindowsApps 副本。" };
  }

  const existing = options.packageFamilyName ? getWindowsPackageRegistration(options.packageFamilyName) : null;
  if (existing && sameWindowsPath(existing.InstallLocation, packageRoot)) {
    return {
      ok: true,
      manifestPath,
      alreadyRegistered: true,
      message: "WindowsApps 插件版已注册。"
    };
  }
  if (existing && options.unregisterExistingDifferentLocation) {
    const unregister = unregisterWindowsPackage(options.packageFamilyName);
    if (unregister && !unregister.ok) {
      return {
        ok: false,
        manifestPath,
        message: unregister.message || "移除旧的 WindowsApps 注册失败。"
      };
    }
  }

  const sideloading = ensureWindowsSideloadingEnabled();
  const developmentModeCommand = [
    "Add-AppxPackage",
    "-Register",
    powershellString(manifestPath),
    "-ForceApplicationShutdown",
    "-ErrorAction",
    "Stop"
  ].join(" ");
  const disableDevelopmentModeCommand = [
    "Add-AppxPackage",
    "-Register",
    powershellString(manifestPath),
    "-DisableDevelopmentMode",
    "-ForceApplicationShutdown",
    "-ErrorAction",
    "Stop"
  ].join(" ");
  const attempts = options.disableDevelopmentModeFirst
    ? [disableDevelopmentModeCommand, developmentModeCommand]
    : [developmentModeCommand, disableDevelopmentModeCommand];

  let last = null;
  for (const command of attempts) {
    const result = runPowerShell(command);
    last = result;
    if (result.status === 0) {
      return { ok: true, manifestPath, sideloading, message: "已注册 WindowsApps 插件版。" };
    }
  }

  const after = options.packageFamilyName ? getWindowsPackageRegistration(options.packageFamilyName) : null;
  if (after && sameWindowsPath(after.InstallLocation, packageRoot)) {
    return {
      ok: true,
      manifestPath,
      sideloading,
      alreadyRegistered: true,
      message: "WindowsApps 插件版已注册。"
    };
  }

  return {
    ok: false,
    manifestPath,
    sideloading,
    message: (last?.stderr || last?.stdout || "注册 WindowsApps 插件版失败。").trim()
  };
}

function ensureWindowsSideloadingEnabled() {
  if (process.platform !== "win32") return null;
  const commands = [
    [
      "reg.exe",
      "ADD",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock",
      "/v",
      "AllowDevelopmentWithoutDevLicense",
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f"
    ],
    [
      "reg.exe",
      "ADD",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock",
      "/v",
      "AllowAllTrustedApps",
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f"
    ],
    [
      "reg.exe",
      "ADD",
      "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx",
      "/v",
      "AllowDevelopmentWithoutDevLicense",
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f"
    ],
    [
      "reg.exe",
      "ADD",
      "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Appx",
      "/v",
      "AllowAllTrustedApps",
      "/t",
      "REG_DWORD",
      "/d",
      "1",
      "/f"
    ]
  ];
  const results = commands.map(([command, ...args]) => childProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
  const failed = results.filter((result) => result.status !== 0);
  return {
    ok: failed.length === 0,
    message: failed.map((result) => (result.stderr || result.stdout || "").trim()).filter(Boolean).join("\n")
  };
}

function grantWindowsPackageAccess(packageRoot) {
  if (process.platform !== "win32" || !safeIsDirectory(packageRoot)) return null;
  const result = childProcess.spawnSync("icacls.exe", [
    packageRoot,
    "/grant",
    "*S-1-15-2-1:(OI)(CI)RX",
    "*S-1-15-2-2:(OI)(CI)RX",
    "/T",
    "/C",
    "/Q"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: result.status === 0,
    message: (result.stderr || result.stdout || "").trim()
  };
}

function unlockWindowsAppsInstall(appPath) {
  if (process.platform !== "win32") return null;
  const packageRoot = windowsAppsPackageRoot(appPath) || appPath;
  const userSid = currentWindowsUserSid();
  const takeown = childProcess.spawnSync("takeown.exe", [
    "/F",
    packageRoot,
    "/A",
    "/R",
    "/D",
    "Y"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const grants = ["*S-1-5-32-544:(OI)(CI)F"];
  if (userSid) grants.push(`*${userSid}:(OI)(CI)F`);
  const icacls = childProcess.spawnSync("icacls.exe", [
    packageRoot,
    "/grant",
    ...grants,
    "/T",
    "/C",
    "/Q"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const attrib = childProcess.spawnSync("attrib.exe", [
    "-R",
    path.join(packageRoot, "*"),
    "/S",
    "/D"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: takeown.status === 0 && icacls.status === 0,
    packageRoot,
    takeown: commandResultSummary(takeown),
    icacls: commandResultSummary(icacls),
    attrib: commandResultSummary(attrib)
  };
}

function currentWindowsUserSid() {
  if (process.platform !== "win32") return null;
  const result = runPowerShell("[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value");
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function commandResultSummary(result) {
  return {
    ok: result.status === 0,
    message: (result.stderr || result.stdout || "").trim()
  };
}

function unregisterWindowsPackage(packageFamilyName) {
  if (process.platform !== "win32") return null;
  const command = [
    `$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq ${powershellString(packageFamilyName)} } | Select-Object -First 1`,
    "if ($null -ne $pkg) { Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop }"
  ].join("; ");
  const result = runPowerShell(command);
  return {
    ok: result.status === 0,
    packageFamilyName,
    message: (result.stderr || result.stdout || (result.status === 0 ? "已移除 WindowsApps 注册。" : "移除 WindowsApps 注册失败。")).trim()
  };
}

function getWindowsPackageRegistration(packageFamilyName) {
  if (process.platform !== "win32" || !packageFamilyName) return null;
  const command = [
    `$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq ${powershellString(packageFamilyName)} } | Select-Object -First 1`,
    "if ($null -ne $pkg) { $pkg | Select-Object PackageFullName, PackageFamilyName, InstallLocation | ConvertTo-Json -Compress }"
  ].join("; ");
  const result = runPowerShell(command);
  const text = result.stdout && result.stdout.trim();
  if (result.status !== 0 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runPowerShell(command) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "$OutputEncoding = [Console]::OutputEncoding",
    command
  ].join("; ");
  return childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function sameWindowsPath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => String(value).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function shouldTryNextWindowsManagedPath(errorOrRegistration) {
  const message = String(errorOrRegistration?.message || errorOrRegistration?.stderr || errorOrRegistration?.stdout || errorOrRegistration || "");
  return (
    /0x80073CF9/i.test(message) ||
    /0x80073CFF/i.test(message) ||
    /manifest.*package root/i.test(message) ||
    /清单.*程序包根目录/.test(message) ||
    /Unsigned/i.test(message) ||
    /旁加载/.test(message) ||
    /AppxManifest\.xml/.test(message)
  );
}

function closeClaudeOnWindows() {
  if (process.platform !== "win32") return;
  for (const imageName of ["Claude.exe", "Claude Desktop.exe"]) {
    childProcess.spawnSync("taskkill.exe", ["/IM", imageName, "/F", "/T"], {
      encoding: "utf8",
      stdio: "ignore"
    });
  }
}

function createWindowsLauncher(appPath, managedRoot, options = {}) {
  if (process.platform !== "win32") return null;
  const executable = findLaunchExecutable(appPath);
  const launcherPath = path.join(managedRoot, `${WINDOWS_SHORTCUT_NAME}.vbs`);
  const launchTarget = options.appUserModelId
    ? `explorer.exe shell:AppsFolder\\${options.appUserModelId}`
    : quotedWindowsCommand(executable);
  ensureDir(managedRoot);
  fs.writeFileSync(launcherPath, [
    "Set shell = CreateObject(\"WScript.Shell\")",
    "On Error Resume Next",
    "shell.Run \"taskkill /IM Claude.exe /F /T\", 0, True",
    "shell.Run \"taskkill /IM \"\"Claude Desktop.exe\"\" /F /T\", 0, True",
    `shell.CurrentDirectory = ${vbscriptString(path.dirname(executable))}`,
    `shell.Run ${vbscriptString(launchTarget)}, 1, False`,
    ""
  ].join("\r\n"), "utf8");
  return launcherPath;
}

function launchManagedWindowsApp(appPath, launcherPath) {
  if (process.platform === "win32" && launcherPath) {
    try {
      const child = childProcess.spawn("wscript.exe", [launcherPath], {
        cwd: path.dirname(launcherPath),
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      return { ok: true, pid: child.pid, command: launcherPath };
    } catch (error) {
      return { ok: false, command: launcherPath, message: error.message };
    }
  }
  return launchApp(appPath);
}

function createWindowsShortcut(appPath, launcherPath = null) {
  if (process.platform !== "win32") return null;
  const executable = findLaunchExecutable(appPath);
  const target = launcherPath || executable;
  const desktopDir = getWindowsDesktopDir();
  removeOldWindowsShortcuts(desktopDir);
  const shortcutPath = path.join(desktopDir, `${WINDOWS_SHORTCUT_NAME}.lnk`);
  ensureDir(desktopDir);

  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut(${powershellString(shortcutPath)})`,
    `$shortcut.TargetPath = ${powershellString(launcherPath ? "wscript.exe" : target)}`,
    launcherPath ? `$shortcut.Arguments = ${powershellString(`"${launcherPath}"`)}` : "$shortcut.Arguments = ''",
    `$shortcut.WorkingDirectory = ${powershellString(path.dirname(target))}`,
    `$shortcut.IconLocation = ${powershellString(`${executable},0`)}`,
    "$shortcut.Save()"
  ].join("; ");
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status === 0) return shortcutPath;
  return createWindowsCommandShortcut(target, desktopDir);
}

function createWindowsCommandShortcut(target, desktopDir) {
  removeOldWindowsShortcuts(desktopDir);
  const shortcutPath = path.join(desktopDir, `${WINDOWS_SHORTCUT_NAME}.cmd`);
  const command = path.extname(target).toLowerCase() === ".vbs"
    ? `wscript.exe "${target}"`
    : `start "" "${target}"`;
  fs.writeFileSync(shortcutPath, `@echo off\r\n${command}\r\n`, "utf8");
  return shortcutPath;
}

function removeOldWindowsShortcuts(desktopDir) {
  for (const name of [
    "Claude 中文版.lnk",
    "Claude 中文版.cmd",
    "Claude CN.vbs",
    `${WINDOWS_SHORTCUT_NAME}.lnk`,
    `${WINDOWS_SHORTCUT_NAME}.cmd`
  ]) {
    safeUnlink(path.join(desktopDir, name));
  }
}

function getWindowsDesktopDir() {
  const fallback = path.join(os.homedir(), "Desktop");
  if (process.platform !== "win32") return fallback;
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "[Environment]::GetFolderPath('Desktop')"
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const desktopDir = result.status === 0 && result.stdout.trim() ? result.stdout.trim() : fallback;
  return desktopDir;
}

function powershellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function vbscriptString(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function quotedWindowsCommand(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function findLaunchExecutable(appPath) {
  if (process.platform === "darwin") {
    const macosDir = path.join(appPath, "Contents", "MacOS");
    const bundleExecutable = readMacBundleExecutable(appPath);
    const candidates = [
      bundleExecutable && path.join(macosDir, bundleExecutable),
      path.join(macosDir, "Claude"),
      ...safeReadDir(macosDir).map((name) => path.join(macosDir, name))
    ].filter(Boolean);
    const executable = candidates.find((candidate) => safeIsFile(candidate));
    if (executable) return executable;
  } else if (process.platform === "win32") {
    const candidates = [
      path.join(appPath, "Claude.exe"),
      ...safeReadDir(appPath).filter((name) => name.toLowerCase().endsWith(".exe")).map((name) => path.join(appPath, name))
    ];
    const executable = candidates.find((candidate) => safeIsFile(candidate));
    if (executable) return executable;
  } else {
    const candidates = [
      appPath,
      path.join(appPath, "claude"),
      path.join(appPath, "Claude"),
      path.join(appPath, "claude-desktop"),
      path.join(appPath, "AppRun"),
      path.join(appPath, "bin", "claude"),
      ...safeReadDir(appPath).map((name) => path.join(appPath, name))
    ];
    const executable = candidates.find((candidate) => safeIsFile(candidate) && isExecutable(candidate));
    if (executable) return executable;
  }
  throw new Error("找不到临时 Claude 的启动文件。请用 --no-launch 只生成临时副本后手动打开。");
}

function readMacBundleExecutable(appPath) {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  if (!fs.existsSync(infoPlist)) return null;
  const result = childProcess.spawnSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleExecutable",
    infoPlist
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return null;
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutable(file) {
  if (process.platform === "win32") return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function patchRootMessages(resourcesPath, backup, changes, options, catalog, languageCatalogs = [catalog]) {
  const enFile = path.join(resourcesPath, "en-US.json");
  if (!fs.existsSync(enFile)) return;

  const source = readJson(enFile);
  const en = patchJsonObject(source, catalog.rootMessages, catalog.phrases, {
    ...options,
    sourceAlternates: catalog.sourceAlternates.rootMessages
  });
  writePatchedJson(enFile, en, backup, changes, options);
  for (const entry of languageCatalogs) {
    const localized = entry === catalog
      ? en
      : patchJsonObject(source, entry.rootMessages, entry.phrases, {
        ...options,
        sourceAlternates: entry.sourceAlternates.rootMessages
      });
    writePatchedJson(path.join(resourcesPath, `${entry.lang}.json`), localized, backup, changes, options);
  }
}

function patchLocalizableStrings(resourcesPath, backup, changes, options, catalog, languageCatalogs = [catalog]) {
  const enFile = path.join(resourcesPath, "en.lproj/Localizable.strings");
  if (!fs.existsSync(enFile)) return;

  const source = fs.readFileSync(enFile);
  const encoding = detectTextEncoding(source);
  const text = decodeText(source, encoding);
  const patched = patchStringsText(text, catalog.localizableStrings, catalog.sourceAlternates.localizableStrings);

  writeFileIfChanged(enFile, encodeText(patched, encoding), backup, changes, options);
  for (const entry of languageCatalogs) {
    const localized = entry === catalog
      ? patched
      : patchStringsText(text, entry.localizableStrings, entry.sourceAlternates.localizableStrings);
    const zhFile = path.join(resourcesPath, `${entry.lang.replace("-", "_")}.lproj/Localizable.strings`);
    writeFileIfChanged(zhFile, encodeText(localized, encoding), backup, changes, options);
  }
}

function patchIonDist(resourcesPath, backup, changes, options, catalog, languageCatalogs = [catalog]) {
  const ionDist = path.join(resourcesPath, "ion-dist");
  if (!safeIsDirectory(ionDist)) return;

  const i18n = path.join(ionDist, "i18n");
  const publicEn = path.join(i18n, "en-US.json");
  if (fs.existsSync(publicEn)) {
    const source = readJson(publicEn);
    const publicMessages = patchJsonObject(source, catalog.publicMessages, catalog.phrases, {
      ...options,
      sourceAlternates: catalog.sourceAlternates.publicMessages
    });
    writePatchedJson(publicEn, publicMessages, backup, changes, options);
    for (const entry of languageCatalogs) {
      const localized = entry === catalog
        ? publicMessages
        : patchJsonObject(source, entry.publicMessages, entry.phrases, {
          ...options,
          sourceAlternates: entry.sourceAlternates.publicMessages
        });
      writePatchedJson(path.join(i18n, `${entry.lang}.json`), localized, backup, changes, options);
      writePatchedJson(path.join(i18n, `${entry.lang}.overrides.json`), {}, backup, changes, options);
    }
  }

  const dynamicEn = path.join(i18n, "dynamic/en-US.json");
  if (fs.existsSync(dynamicEn)) {
    const source = readJson(dynamicEn);
    const dynamicMessages = patchJsonObject(source, {}, catalog.dynamicPhrases, options);
    writePatchedJson(dynamicEn, dynamicMessages, backup, changes, options);
    for (const entry of languageCatalogs) {
      const localized = entry === catalog ? dynamicMessages : patchJsonObject(source, {}, entry.dynamicPhrases, options);
      writePatchedJson(path.join(i18n, `dynamic/${entry.lang}.json`), localized, backup, changes, options);
    }
  }

  const domScript = buildDomScript(catalog);
  writeFileIfChanged(path.join(ionDist, "assets/claude-zh-cn-dom.js"), Buffer.from(domScript, "utf8"), backup, changes, options);

  for (const htmlName of ["index.html", "frame-shell.html", "frame-gallery.html"]) {
    const htmlFile = path.join(ionDist, htmlName);
    if (!fs.existsSync(htmlFile)) continue;
    const html = fs.readFileSync(htmlFile, "utf8");
    const patched = patchHtml(html, catalog);
    writeFileIfChanged(htmlFile, Buffer.from(patched, "utf8"), backup, changes, options);
  }
}

function patchAsarPreload(resourcesPath, backup, changes, options, catalog) {
  const asarFile = path.join(resourcesPath, "app.asar");
  if (!fs.existsSync(asarFile) || !isValidAsar(asarFile)) return;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-asar-"));
  const extractDir = path.join(tempRoot, "app");
  const packedAsar = path.join(tempRoot, "app.asar");

  try {
    runAsar(["extract", asarFile, extractDir]);
    const preloadFile = path.join(extractDir, ".vite/build/mainView.js");
    if (!fs.existsSync(preloadFile)) return;

    const source = fs.readFileSync(preloadFile, "utf8");
    if (source.includes(preloadMarker(catalog))) {
      updateWindowsAsarIntegrity(resourcesPath, backup, changes, options);
      return;
    }

    fs.writeFileSync(preloadFile, injectPreloadScript(source, catalog), "utf8");
    runAsar(["pack", extractDir, packedAsar, "--unpack", "**/{*.node,*.dylib,spawn-helper}"]);

    writeFileIfChanged(asarFile, fs.readFileSync(packedAsar), backup, changes, options);
    updateMacAsarIntegrity(resourcesPath, backup, changes, options);
    updateWindowsAsarIntegrity(resourcesPath, backup, changes, options);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function isValidAsar(asarFile) {
  try {
    require("@electron/asar").getRawHeader(asarFile);
    return true;
  } catch {
    return false;
  }
}

function runAsar(args) {
  const bin = require.resolve("@electron/asar/bin/asar.js");
  const result = childProcess.spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `asar ${args[0]} failed`);
  }
}

function preloadMarker(catalog) {
  return `${CURRENT_PRELOAD_MARKER} ${catalog.lang}`;
}

function injectPreloadScript(source, catalog) {
  const sourceMap = "\n//# sourceMappingURL=mainView.js.map";
  if (source.includes(preloadMarker(catalog))) return source;

  let body = source;
  let suffix = "";
  if (body.endsWith(sourceMap)) {
    body = body.slice(0, -sourceMap.length);
    suffix = sourceMap;
  }

  body = removeExistingPreloadPatch(body).replace(/\s*$/, "");
  const script = `\n// ${preloadMarker(catalog)}\n${buildPreloadInjectionScript(catalog)}\n`;
  return `${body}${script}${suffix}`;
}

function removeExistingPreloadPatch(source) {
  const markerIndex = source.lastIndexOf(`// ${PRELOAD_MARKER_PREFIX}`);
  if (markerIndex === -1) return source;
  return source.slice(0, markerIndex);
}

function buildPreloadInjectionScript(catalog) {
  const pageScript = buildDomScript(catalog);
  return `;(() => {
  const marker = ${JSON.stringify(preloadMarker(catalog))};
  if (globalThis.__CLAUDE_ZH_CN_PRELOAD_ACTIVE__) return;
  globalThis.__CLAUDE_ZH_CN_PRELOAD_ACTIVE__ = true;
  const pageScript = ${JSON.stringify(pageScript)};

  function electronRenderer() {
    try { return require("electron/renderer"); } catch {}
    try { return require("electron"); } catch {}
    return null;
  }

  function runInIsolatedWorld() {
    try {
      Function(pageScript)();
    } catch (error) {
      try { console.debug(marker, "isolated world failed", error && error.message); } catch {}
    }
  }

  function runInPageWorld() {
    try {
      const renderer = electronRenderer();
      const webFrame = renderer && renderer.webFrame;
      if (webFrame && typeof webFrame.executeJavaScript === "function") {
        Promise.resolve(webFrame.executeJavaScript(pageScript, false)).catch(runInIsolatedWorld);
        return;
      }
    } catch {}
    runInIsolatedWorld();
  }

  function startWhenReady() {
    if (typeof document === "undefined") return;
    if (!document.documentElement) {
      setTimeout(startWhenReady, 50);
      return;
    }
    runInPageWorld();
  }

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWhenReady, { once: true });
  } else {
    startWhenReady();
  }
})();\n`;
}

function updateMacAsarIntegrity(resourcesPath, backup, changes, options) {
  if (process.platform !== "darwin") return;

  const infoPlist = path.resolve(resourcesPath, "../Info.plist");
  if (!fs.existsSync(infoPlist)) return;

  const relativePath = path.join("..", "Info.plist");
  backupFile(infoPlist, relativePath, backup, options);
  changes.push(relativePath);
  if (options.dryRun) return;

  const asarFile = path.join(resourcesPath, "app.asar");
  const hash = getAsarIntegrityHash(asarFile);

  const result = childProcess.spawnSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,
    infoPlist
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "更新 ElectronAsarIntegrity 失败");
  }
}

function updateWindowsAsarIntegrity(resourcesPath, backup, changes, options) {
  if (process.platform !== "win32") return;

  const exeFile = findWindowsClaudeExecutableNearResources(resourcesPath);
  if (!exeFile) return;

  const asarFile = path.join(resourcesPath, "app.asar");
  const hash = getAsarIntegrityHash(asarFile);
  const marker = Buffer.from('resources\\\\app.asar","alg":"SHA256","value":"', "ascii");
  const exe = fs.readFileSync(exeFile);
  const markerIndex = exe.indexOf(marker);
  if (markerIndex < 0) return;
  if (exe.indexOf(marker, markerIndex + 1) >= 0) {
    throw new Error("Claude.exe 中存在多个 app.asar 完整性标记，已停止写入。");
  }

  const hashOffset = markerIndex + marker.length;
  const hashEnd = hashOffset + 64;
  if (hashEnd > exe.length) {
    throw new Error("Claude.exe app.asar 完整性标记位置异常，已停止写入。");
  }

  const currentHash = exe.subarray(hashOffset, hashEnd).toString("ascii");
  if (currentHash === hash) return;
  if (!/^[0-9a-fA-F]{64}$/.test(currentHash)) {
    throw new Error("Claude.exe app.asar 完整性哈希格式异常，已停止写入。");
  }

  const patched = Buffer.from(exe);
  patched.write(hash, hashOffset, 64, "ascii");
  writeFileIfChanged(exeFile, patched, backup, changes, options);
}

function repairMacAppSignature(install, backup, changes, options = {}) {
  if (process.platform !== "darwin" || options.dryRun || options.skipCodeSign) return null;
  if (!isMacAppBundle(install.appPath)) return null;
  const targets = collectMacSigningTargets(install.appPath);
  if (isMacCodeSignatureValid(install.appPath)) {
    clearMacQuarantine(install.appPath);
    return {
      status: "valid",
      keychain: repairMacSafeStorageKeychain(install.appPath, targets, options)
    };
  }

  if (!targets.files.length && !targets.bundles.length) return null;
  if (backup) backupMacSigningTargets(install, backup, changes, targets);

  signMacApp(install.appPath, targets);
  clearMacQuarantine(install.appPath);

  if (!isMacCodeSignatureValid(install.appPath)) {
    throw new Error("macOS 重签名后验证失败。请恢复 Claude.app 或重新安装 Claude 后再执行。");
  }
  return {
    status: "signed",
    files: targets.files.length,
    bundles: targets.bundles.length + 1,
    keychain: repairMacSafeStorageKeychain(install.appPath, targets, options)
  };
}

function isMacAppBundle(appPath) {
  if (!appPath || path.extname(appPath).toLowerCase() !== ".app") return false;
  const contents = path.join(appPath, "Contents");
  const macosDir = path.join(contents, "MacOS");
  return safeIsDirectory(contents) && safeIsDirectory(macosDir) && Boolean(findMacExecutable(appPath));
}

function findMacExecutable(appPath) {
  const macosDir = path.join(appPath, "Contents", "MacOS");
  const bundleExecutable = readMacBundleExecutable(appPath);
  const candidates = [
    bundleExecutable && path.join(macosDir, bundleExecutable),
    path.join(macosDir, "Claude"),
    ...safeReadDir(macosDir).map((name) => path.join(macosDir, name))
  ].filter(Boolean);
  return candidates.find((candidate) => safeIsFile(candidate) && isExecutable(candidate)) || null;
}

function isMacCodeSignatureValid(appPath) {
  const result = childProcess.spawnSync("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return result.status === 0;
}

function collectMacSigningTargets(appPath) {
  const contents = path.join(appPath, "Contents");
  const bundleSuffixes = new Set([".app", ".framework", ".xpc", ".appex", ".plugin", ".bundle"]);
  const bundles = [];
  const files = [];
  const stack = [contents];

  while (stack.length) {
    const current = stack.pop();
    for (const name of safeReadDir(current)) {
      const candidate = path.join(current, name);
      let stat = null;
      try {
        stat = fs.lstatSync(candidate);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (bundleSuffixes.has(path.extname(candidate))) bundles.push(candidate);
        stack.push(candidate);
      } else if (isMacSignableFile(candidate)) {
        files.push(candidate);
      }
    }
  }

  return {
    files: [...new Set(files)].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length),
    bundles: [...new Set(bundles)].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)
  };
}

function isMacSignableFile(file) {
  if (!safeIsFile(file)) return false;
  const ext = path.extname(file).toLowerCase();
  return [".dylib", ".node", ".so"].includes(ext) || isExecutable(file);
}

function backupMacSigningTargets(install, backup, changes, targets) {
  const candidates = [
    ...targets.files,
    ...collectMacCodeSignatureFiles(install.appPath),
    path.join(install.appPath, "Contents", "_CodeSignature", "CodeResources")
  ];

  for (const candidate of [...new Set(candidates)]) {
    const relativePath = path.relative(install.resourcesPath, candidate);
    if (!relativePath || relativePath === ".") continue;
    if (backup.files.has(relativePath)) continue;
    backupFile(candidate, relativePath, backup, {});
    changes.push(relativePath);
  }
}

function collectMacCodeSignatureFiles(appPath) {
  const output = [];
  const stack = [path.join(appPath, "Contents")];
  while (stack.length) {
    const current = stack.pop();
    for (const name of safeReadDir(current)) {
      const candidate = path.join(current, name);
      let stat = null;
      try {
        stat = fs.lstatSync(candidate);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        stack.push(candidate);
      } else if (candidate.split(path.sep).includes("_CodeSignature")) {
        output.push(candidate);
      }
    }
  }
  return output;
}

function signMacApp(appPath, targets) {
  const entitlementsDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-entitlements-"));
  try {
    for (const file of targets.files) signMacPath(file, entitlementsDir);
    for (const bundle of targets.bundles) signMacPath(bundle, entitlementsDir);
    signMacPath(appPath, entitlementsDir);
  } finally {
    fs.rmSync(entitlementsDir, { recursive: true, force: true });
  }
}

function signMacPath(target, entitlementsDir) {
  const entitlements = readMacEntitlements(target);
  const args = [
    "--force",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--preserve-metadata=identifier,flags"
  ];

  if (entitlements) {
    const entitlementFile = path.join(entitlementsDir, `${crypto.randomBytes(8).toString("hex")}.plist`);
    fs.writeFileSync(entitlementFile, patchMacEntitlements(entitlements), "utf8");
    args.push("--entitlements", entitlementFile);
  }
  args.push(target);

  const result = childProcess.spawnSync("codesign", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `macOS 重签名失败：${target}`);
  }
}

function readMacEntitlements(target) {
  const result = childProcess.spawnSync("codesign", [
    "-d",
    "--entitlements",
    ":-",
    target
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const plistIndex = output.indexOf("<?xml");
  const fallbackIndex = output.indexOf("<plist");
  const start = plistIndex >= 0 ? plistIndex : fallbackIndex;
  if (start < 0) return null;
  const end = output.indexOf("</plist>", start);
  if (end < 0) return null;
  return output.slice(start, end + "</plist>".length).trim();
}

function patchMacEntitlements(xml) {
  let patched = xml;
  for (const key of [
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
    "keychain-access-groups",
    "com.apple.security.cs.disable-library-validation"
  ]) {
    patched = removePlistKey(patched, key);
  }
  return patched.replace(
    /<\/dict>/,
    "  <key>com.apple.security.cs.disable-library-validation</key>\n  <true/>\n</dict>"
  );
}

function removePlistKey(xml, key) {
  const valuePattern = [
    "<array>[\\s\\S]*?<\\/array>",
    "<dict>[\\s\\S]*?<\\/dict>",
    "<string>[\\s\\S]*?<\\/string>",
    "<data>[\\s\\S]*?<\\/data>",
    "<integer>[\\s\\S]*?<\\/integer>",
    "<real>[\\s\\S]*?<\\/real>",
    "<true\\s*\\/>",
    "<false\\s*\\/>"
  ].join("|");
  const pattern = new RegExp(`\\s*<key>${escapeRegExp(key)}<\\/key>\\s*(?:${valuePattern})`, "g");
  return xml.replace(pattern, "");
}

function clearMacQuarantine(appPath) {
  childProcess.spawnSync("xattr", ["-dr", "com.apple.quarantine", appPath], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"]
  });
}

function repairMacSafeStorageKeychain(appPath, targets, options = {}) {
  if (options.skipKeychain) return null;
  const keychain = macLoginKeychainPath();
  if (!keychain || !fs.existsSync(keychain)) return { status: "missing-keychain" };

  const trusted = collectMacKeychainTrustedPaths(appPath, targets);
  const cdhashes = trusted.map(getMacCdHash).filter(Boolean);
  if (!cdhashes.length) return { status: "no-cdhash" };

  const existing = readMacSafeStorageAccess(keychain);
  if (!existing.exists) {
    return createMacSafeStorageKeychainItem(keychain, trusted, cdhashes);
  }

  const lowerBlock = existing.block.toLowerCase();
  const missing = cdhashes.filter((hash) => !lowerBlock.includes(hash.toLowerCase()));
  if (!missing.length) return { status: "valid", cdhashes: cdhashes.length };

  const partitions = new Set(existing.partitions);
  partitions.add("apple-tool:");
  for (const hash of cdhashes) partitions.add(`cdhash:${hash}`);
  const partitionList = [...partitions].join(",");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { status: "needs-password", cdhashes: missing.length };
  }

  if (!options.quiet) {
    process.stderr.write("macOS 登录态修复需要输入当前 macOS 登录密码（不是 Claude 密码）。\n");
  }
  const result = runMacSecurity([
    "set-generic-password-partition-list",
    "-a",
    "Claude Key",
    "-s",
    "Claude Safe Storage",
    "-S",
    partitionList,
    keychain
  ], { interactive: true });
  if (result.status !== 0) {
    return { status: "needs-password", cdhashes: missing.length };
  }

  const updated = readMacSafeStorageAccess(keychain);
  const updatedBlock = updated.block.toLowerCase();
  const stillMissing = cdhashes.filter((hash) => !updatedBlock.includes(hash.toLowerCase()));
  if (stillMissing.length) return { status: "failed", cdhashes: stillMissing.length };
  return { status: "updated", cdhashes: missing.length };
}

function collectMacKeychainTrustedPaths(appPath, targets) {
  const paths = [
    appPath,
    findMacExecutable(appPath),
    ...targets.bundles,
    ...targets.files
  ].filter(Boolean);
  return [...new Set(paths)].filter((candidate) => safeIsFile(candidate) || safeIsDirectory(candidate));
}

function getMacCdHash(target) {
  const result = childProcess.spawnSync("codesign", ["-dvvv", target], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(/CDHash=([0-9a-f]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function readMacSafeStorageAccess(keychain) {
  const result = runMacSecurity(["dump-keychain", "-a", keychain]);
  const output = result.stdout || "";
  const block = output
    .split(/keychain:/)
    .find((entry) => entry.includes('"svce"<blob>="Claude Safe Storage"')) || "";
  const partitions = new Set();
  for (const match of block.matchAll(/(?:teamid|cdhash|apple-tool|apple):[^,\s]*/g)) {
    partitions.add(match[0].replace(/,$/, ""));
  }
  return {
    exists: Boolean(block),
    block,
    partitions
  };
}

function createMacSafeStorageKeychainItem(keychain, trusted, cdhashes) {
  const password = crypto.randomBytes(16).toString("base64");
  const args = [
    "add-generic-password",
    "-a",
    "Claude Key",
    "-s",
    "Claude Safe Storage",
    "-w",
    password
  ];
  for (const target of trusted) args.push("-T", target);
  args.push(keychain);

  const result = runMacSecurity(args);
  if (result.status !== 0) {
    return { status: "create-failed", cdhashes: cdhashes.length };
  }

  const partitions = new Set(["apple-tool:"]);
  for (const hash of cdhashes) partitions.add(`cdhash:${hash}`);
  const partitionResult = runMacSecurity([
    "set-generic-password-partition-list",
    "-a",
    "Claude Key",
    "-s",
    "Claude Safe Storage",
    "-S",
    [...partitions].join(","),
    keychain
  ]);
  return {
    status: partitionResult.status === 0 ? "created" : "created-without-partitions",
    cdhashes: cdhashes.length
  };
}

function macLoginKeychainPath() {
  const home = macTargetUserHome();
  return home ? path.join(home, "Library", "Keychains", "login.keychain-db") : null;
}

function macTargetUserHome() {
  const sudoUser = macSudoUser();
  if (!sudoUser) return os.homedir();
  const result = childProcess.spawnSync("dscl", [".", "-read", `/Users/${sudoUser}`, "NFSHomeDirectory"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const match = result.stdout && result.stdout.match(/NFSHomeDirectory:\s*(.+)/);
  if (match && match[1]) return match[1].trim();
  return path.join("/Users", sudoUser);
}

function macSudoUser() {
  const user = process.env.SUDO_USER;
  if (!user || user === "root") return null;
  return user;
}

function runMacSecurity(args, options = {}) {
  const sudoUser = macSudoUser();
  const home = macTargetUserHome();
  const command = sudoUser ? "sudo" : "security";
  const finalArgs = sudoUser ? ["-u", sudoUser, "security", ...args] : args;
  return childProcess.spawnSync(command, finalArgs, {
    encoding: options.interactive ? undefined : "utf8",
    stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home || process.env.HOME
    }
  });
}

function findWindowsClaudeExecutableNearResources(resourcesPath) {
  const appPath = path.dirname(resourcesPath);
  for (const name of ["Claude.exe", "claude.exe"]) {
    const candidate = path.join(appPath, name);
    if (safeIsFile(candidate)) return candidate;
  }
  return null;
}

function getAsarIntegrityHash(asarFile) {
  const { headerString } = require("@electron/asar").getRawHeader(asarFile);
  return crypto.createHash("sha256").update(headerString).digest("hex");
}

function patchJsonObject(data, idTranslations, phraseTranslations, options = {}) {
  const cloned = Array.isArray(data) ? [...data] : { ...data };
  for (const [key, value] of Object.entries(cloned)) {
    if (Object.prototype.hasOwnProperty.call(idTranslations, key)) {
      const translated = idTranslations[key];
      const alternates = options.sourceAlternates && options.sourceAlternates[key];
      cloned[key] = typeof value === "string" && alternates && Object.prototype.hasOwnProperty.call(alternates, value)
        ? alternates[value]
        : translated;
    } else if (typeof value === "string" && Object.prototype.hasOwnProperty.call(phraseTranslations, value)) {
      cloned[key] = phraseTranslations[value];
    }
  }
  return cloned;
}

function patchStringsText(text, translations, alternates = {}) {
  let output = text;
  for (const [key, value] of Object.entries(translations)) {
    const escapedKey = escapeRegExp(key);
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const pattern = new RegExp(`("${escapedKey}"\\s*=\\s*")([^"]*)(";?)`, "g");
    let found = false;
    output = output.replace(pattern, (match, prefix, current, suffix) => {
      found = true;
      return `${prefix}${escapedValue}${suffix}`;
    });
    if (!found) {
      output += `\n"${key}" = "${escapedValue}";\n`;
    }
  }
  for (const [key, values] of Object.entries(alternates)) {
    const escapedKey = escapeRegExp(key);
    const escapedValue = translations[key]?.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (!escapedValue || !values || typeof values !== "object") continue;
    const currentValues = Object.keys(values);
    for (const currentValue of currentValues) {
      const pattern = new RegExp(`("${escapedKey}"\\s*=\\s*")${escapeRegExp(currentValue)}(";?)`, "g");
      output = output.replace(pattern, `$1${escapedValue}$2`);
    }
  }
  return output;
}

function patchHtml(html, catalog) {
  let output = html;
  output = output.replace(/<html([^>]*)\blang="[^"]*"/, `<html$1 lang="${catalog.lang}"`);
  output = output.replace(
    /content="Claude is Anthropic's AI, built for problem solvers\. Tackle complex challenges, analyze data, write code, and think through your hardest work\."/,
    `content="${escapeHtmlAttribute(catalog.metaDescription)}"`
  );
  if (!output.includes("claude-zh-cn-dom.js")) {
    const script = '<script src="/assets/claude-zh-cn-dom.js" data-claude-zh-cn></script>';
    output = output.includes("</body>") ? output.replace("</body>", `${script}</body>`) : `${output}${script}`;
  }
  return output;
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildRuntimeDomCatalog(catalog) {
  return {
    lang: catalog.lang,
    translations: catalog.allPhrases,
    compoundTranslations: catalog.compoundPhrases,
    patternPhrases: catalog.patternPhrases
  };
}

function buildEnglishRuntimeDomCatalog() {
  const cnCatalog = createCatalog({ locale: "cn" });
  const twCatalog = createCatalog({ locale: "tw" });
  return {
    lang: "en-US",
    translations: buildReverseDomTranslations(ALL_PHRASES, cnCatalog.allPhrases, twCatalog.allPhrases),
    compoundTranslations: buildReverseDomTranslations(COMPOUND_PHRASES, cnCatalog.compoundPhrases, twCatalog.compoundPhrases),
    patternPhrases: {}
  };
}

function buildReverseDomTranslations(sourcePhrases, cnPhrases, twPhrases) {
  const output = {};
  for (const source of Object.keys(sourcePhrases)) {
    if (/[\u3400-\u9fff]/.test(source)) continue;
    const cn = cnPhrases[source];
    const tw = twPhrases[source];
    if (typeof cn === "string") output[cn] = source;
    if (typeof tw === "string") output[tw] = source;
    output[source] = source;
  }
  return output;
}

function buildDomScript(catalog) {
  const runtimeCatalogs = {
    "en-US": buildEnglishRuntimeDomCatalog(),
    "zh-CN": buildRuntimeDomCatalog(createCatalog({ locale: "cn" })),
    "zh-TW": buildRuntimeDomCatalog(createCatalog({ locale: "tw" }))
  };
  return `;(() => {
  try {
    const marker = ${JSON.stringify(MARKER)};
    if (window.__CLAUDE_ZH_CN_ACTIVE__) return;
    window.__CLAUDE_ZH_CN_ACTIVE__ = true;

    const catalogs = ${JSON.stringify(runtimeCatalogs, null, 2)};
    const defaultLang = ${JSON.stringify(catalog.lang)};
    const languageStorageKey = "claude-zh-cn-active-lang";
    const defaultLanguageStorageKey = "claude-zh-cn-default-lang";
    const officialLanguageStorageKey = "claude-zh-cn-official-language";
    const officialLocaleStorageKey = "spa:locale";
    const officialNonEnglishStorageValue = "__claude_zh_cn_official_non_english__";
    const languageLabels = {
      "en-US": "English",
      "zh-CN": "简体中文",
      "zh-TW": "繁體中文"
    };
    const officialLanguageLabels = [
      "English (United States)",
      "Français (France)",
      "Deutsch (Deutschland)",
      "हिन्दी (भारत)",
      "Indonesia (Indonesia)",
      "Italiano (Italia)",
      "日本語 (日本)",
      "한국어(대한민국)",
      "Português (Brasil)",
      "Español (Latinoamérica)",
      "Español (España)"
    ];
    const officialLanguageLocaleByLabel = {
      "English (United States)": "en-US",
      "Français (France)": "fr-FR",
      "Deutsch (Deutschland)": "de-DE",
      "हिन्दी (भारत)": "hi-IN",
      "Indonesia (Indonesia)": "id-ID",
      "Italiano (Italia)": "it-IT",
      "日本語 (日本)": "ja-JP",
      "한국어(대한민국)": "ko-KR",
      "Português (Brasil)": "pt-BR",
      "Español (Latinoamérica)": "es-419",
      "Español (España)": "es-ES"
    };
    const officialLanguageLabelByLocale = Object.fromEntries(
      Object.entries(officialLanguageLocaleByLabel).map(([label, locale]) => [locale, label])
    );
    const attrNames = ["aria-label", "aria-description", "title", "placeholder", "alt"];
    const ignoredTextParents = new Set(["SCRIPT", "STYLE", "CODE", "PRE"]);

    function buildPatternTranslations(patternPhrases) {
      return [
      [/^What['’]s up next, (.+)\\?$/, patternPhrases.whatsUpNextWithName],
      [/^You['’]ve used ~(.+) more tokens than The Little Prince\\.$/, patternPhrases.littlePrinceTokens],
      [/^You['’]re running Claude through your organization['’]s own inference provider \\((.+)\\)\\. Your conversations are sent there, not to Anthropic, and are governed by your organization['’]s agreement with that provider\\.$/, patternPhrases.inferenceProvider],
      [/^Your artifacts and scheduled tasks are stored at (.+)\\.$/, patternPhrases.coworkFilesPath],
      [/^(.+) Not recognized$/, patternPhrases.notRecognized],
      [/^(\\d+) of (\\d+) sessions$/, patternPhrases.sessionCount],
      [/^(\\d+)% used$/, patternPhrases.percentUsed],
      [/^Resets in (\\d+) hr (\\d+) min$/, patternPhrases.resetsInHoursMinutes],
      [/^Resets in (\\d+) hrs (\\d+) mins$/, patternPhrases.resetsInHoursMinutes],
      [/^Resets in (\\d+) hr$/, patternPhrases.resetsInHours],
      [/^Resets in (\\d+) hrs$/, patternPhrases.resetsInHours],
      [/^Resets in (\\d+) min$/, patternPhrases.resetsInMinutes],
      [/^Resets in (\\d+) mins$/, patternPhrases.resetsInMinutes],
      [/^Resets Mon (.+)$/, patternPhrases.resetsMon],
      [/^Resets Tue (.+)$/, patternPhrases.resetsTue],
      [/^Resets Wed (.+)$/, patternPhrases.resetsWed],
      [/^Resets Thu (.+)$/, patternPhrases.resetsThu],
      [/^Resets Fri (.+)$/, patternPhrases.resetsFri],
      [/^Resets Sat (.+)$/, patternPhrases.resetsSat],
      [/^Resets Sun (.+)$/, patternPhrases.resetsSun],
      [/^Connected (\\d+) minutes ago$/, patternPhrases.connectedMinutesAgo],
      [/^Connected 1 minute ago$/, patternPhrases.connectedMinuteAgo],
      [/^Last updated: (\\d+) minutes ago$/, patternPhrases.lastUpdatedMinutesAgo],
      [/^Last updated: 1 minute ago$/, patternPhrases.lastUpdatedMinuteAgo],
      [/^Updated (\\d+) days ago$/, patternPhrases.updatedDaysAgo],
      [/^Updated 1 day ago$/, patternPhrases.updatedDayAgo],
      [/^(\\d+)%\\s*[·•]\\s*resets (\\d+)h$/, patternPhrases.usageResetsHours],
      [/^(\\d+)%\\s*[·•]\\s*resets (\\d+)d$/, patternPhrases.usageResetsDays],
      [/^Showing (\\d+)-(\\d+) of (\\d+)$/, patternPhrases.showingRange],
      [/^Page (\\d+) of (\\d+)$/, patternPhrases.pageOf],
      [/^(\\d+) of (\\d+)$/, patternPhrases.count]
      ].filter((entry) => typeof entry[1] === "string" && entry[1]);
    }

    function readStorage(key) {
      try { return window.localStorage && window.localStorage.getItem(key); } catch {}
      return null;
    }

    function writeStorage(key, value) {
      try {
        if (window.localStorage) window.localStorage.setItem(key, value);
      } catch {}
    }

    function removeStorage(key) {
      try {
        if (window.localStorage) window.localStorage.removeItem(key);
      } catch {}
    }

    function normalizeLang(value) {
      if (!value) return "";
      const original = String(value).trim();
      const normalized = original.toLowerCase().replace(/_/g, "-");
      if (["en", "en-us", "english", "english-united-states"].includes(normalized)) return "en-US";
      if (["cn", "zh", "zh-cn", "simplified", "simplified-chinese"].includes(normalized)) return "zh-CN";
      if (["tw", "zh-tw", "traditional", "traditional-chinese", "taiwan"].includes(normalized)) return "zh-TW";
      return catalogs[original] ? original : "";
    }

    function getInitialLang() {
      const storedDefault = readStorage(defaultLanguageStorageKey);
      if (storedDefault !== defaultLang) {
        writeStorage(defaultLanguageStorageKey, defaultLang);
        removeStorage(languageStorageKey);
        removeStorage(officialLanguageStorageKey);
        return defaultLang;
      }
      return normalizeLang(readStorage(languageStorageKey)) || defaultLang;
    }

    function normalizeOfficialLocale(value) {
      if (!value) return "";
      const normalized = String(value).trim().toLowerCase().replace(/_/g, "-");
      const localeMap = {
        "en": "en-US",
        "en-us": "en-US",
        "fr": "fr-FR",
        "fr-fr": "fr-FR",
        "de": "de-DE",
        "de-de": "de-DE",
        "hi": "hi-IN",
        "hi-in": "hi-IN",
        "id": "id-ID",
        "id-id": "id-ID",
        "it": "it-IT",
        "it-it": "it-IT",
        "ja": "ja-JP",
        "ja-jp": "ja-JP",
        "ko": "ko-KR",
        "ko-kr": "ko-KR",
        "pt": "pt-BR",
        "pt-br": "pt-BR",
        "es-419": "es-419",
        "es": "es-ES",
        "es-es": "es-ES"
      };
      return localeMap[normalized] || "";
    }

    function getStoredOfficialLocale() {
      return normalizeOfficialLocale(readStorage(officialLocaleStorageKey));
    }

    function getStoredOfficialEnglishSelected() {
      const locale = getStoredOfficialLocale();
      if (locale) return locale === "en-US";
      const stored = readStorage(officialLanguageStorageKey);
      return !stored || stored === officialLanguageLabels[0];
    }

    let activeLang = getInitialLang();
    let currentCatalog = catalogs[activeLang] || catalogs[defaultLang] || catalogs["zh-CN"];
    let patternTranslations = buildPatternTranslations(currentCatalog.patternPhrases || {});
    let officialEnglishSelected = getStoredOfficialEnglishSelected();
    let officialEnglishRestorePendingUntil = 0;

    function setOfficialSelectedLabel(label) {
      const storedLocale = getStoredOfficialLocale();
      const next = label === officialNonEnglishStorageValue && storedLocale
        ? officialLanguageLabelByLocale[storedLocale] || officialNonEnglishStorageValue
        : label || officialLanguageLabels[0];
      const nextLocale = officialLanguageLocaleByLabel[next];
      writeStorage(officialLanguageStorageKey, next);
      if (nextLocale) writeStorage(officialLocaleStorageKey, nextLocale);
      officialEnglishSelected = nextLocale ? nextLocale === "en-US" : getStoredOfficialEnglishSelected();
      updateLanguageMenuChecks();
    }

    function setLang() {
      if (document.documentElement) document.documentElement.lang = currentCatalog.lang;
    }

    function setActiveLang(nextLang, persist) {
      const normalized = normalizeLang(nextLang);
      if (!normalized || !catalogs[normalized]) return;
      activeLang = normalized;
      currentCatalog = catalogs[activeLang];
      patternTranslations = buildPatternTranslations(currentCatalog.patternPhrases || {});
      setOfficialSelectedLabel(officialLanguageLabels[0]);
      if (persist) writeStorage(languageStorageKey, activeLang);
      setLang();
      translateTree(document.documentElement);
      updateLanguageMenuChecks();
      try {
        window.dispatchEvent(new CustomEvent("claude-zh-cn-languagechange", { detail: { lang: activeLang } }));
      } catch {}
    }

    function translateValue(value) {
      if (!value || typeof value !== "string") return value;
      const trimmed = value.trim();
      const translations = currentCatalog.translations || {};
      const exact = translations[trimmed];
      if (exact) return value.replace(trimmed, exact);
      const collapsed = trimmed.replace(/\\s+/g, " ");
      const collapsedExact = translations[collapsed];
      if (collapsedExact) return value.replace(trimmed, collapsedExact);
      for (const [pattern, replacement] of patternTranslations) {
        if (pattern.test(collapsed)) return value.replace(trimmed, collapsed.replace(pattern, replacement));
      }
      return value;
    }

    function translateCompoundNode(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      if (!node.children || node.children.length === 0) return;
      if (ignoredTextParents.has(node.tagName) || node.closest("[contenteditable='true']")) return;
      const text = node.textContent;
      if (!text || text.trim().length > 300) return;
      const collapsed = text.trim().replace(/\\s+/g, " ");
      const compoundTranslations = currentCatalog.compoundTranslations || {};
      const exact = compoundTranslations[collapsed];
      if (exact && collapsed !== exact) node.textContent = exact;
    }

    function translateNode(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || ignoredTextParents.has(parent.tagName) || parent.closest("[contenteditable='true']")) return;
        const next = translateValue(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      for (const attr of attrNames) {
        const current = node.getAttribute(attr);
        const next = translateValue(current);
        if (next !== current) node.setAttribute(attr, next);
      }
      translateCompoundNode(node);
      if (node.shadowRoot) translateTree(node.shadowRoot);
    }

    function normalizeDisplayText(value) {
      return String(value || "").replace(/\\s+/g, " ").trim();
    }

    function countOfficialLanguageLabels(text) {
      return officialLanguageLabels.reduce((count, label) => count + (text.includes(label) ? 1 : 0), 0);
    }

    function isElementVisible(element) {
      try {
        const style = window.getComputedStyle(element);
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
        const rects = element.getClientRects && element.getClientRects();
        return !rects || rects.length > 0;
      } catch {
        return true;
      }
    }

    function elementRect(element) {
      try {
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return rect;
      } catch {
        return null;
      }
    }

    function rectContains(outer, inner) {
      return inner.left >= outer.left - 4
        && inner.right <= outer.right + 4
        && inner.top >= outer.top - 4
        && inner.bottom <= outer.bottom + 4;
    }

    function rectNearContainer(outer, inner) {
      return inner.right >= outer.left - 8
        && inner.left <= outer.right + 24
        && inner.bottom >= outer.top - 8
        && inner.top <= outer.bottom + 8;
    }

    function rectCenterY(rect) {
      return rect.top + rect.height / 2;
    }

    function rectAlignsWithRow(rect, rowRect) {
      if (!rect || !rowRect) return false;
      return Math.abs(rectCenterY(rect) - rectCenterY(rowRect)) <= Math.max(24, rowRect.height * 0.65);
    }

    function findLanguageMenu() {
      if (!document.querySelectorAll) return null;
      const selector = "div,section,nav,[role='menu'],[role='listbox'],[role='presentation'],[data-radix-popper-content-wrapper]";
      let best = null;
      let bestLength = Infinity;
      for (const element of document.querySelectorAll(selector)) {
        if (!isElementVisible(element)) continue;
        const text = normalizeDisplayText(element.textContent);
        if (text.length < 80 || text.length > 900) continue;
        const matchCount = countOfficialLanguageLabels(text);
        if (matchCount < 5) continue;
        const childMatches = Array.from(element.children || []).filter((child) => {
          const childText = normalizeDisplayText(child.textContent);
          return countOfficialLanguageLabels(childText) > 0 || child.querySelector?.("[data-claude-zh-cn-language-option]");
        }).length;
        if (childMatches < 3 && matchCount < 8) continue;
        if (text.length < bestLength) {
          best = element;
          bestLength = text.length;
        }
      }
      return best;
    }

    function findLanguageItem(container, label) {
      const selector = "button,[role='menuitem'],[role='option'],[data-radix-collection-item],div";
      let best = null;
      let bestScore = Infinity;
      for (const element of container.querySelectorAll(selector)) {
        if (element.dataset && element.dataset.claudeZhCnLanguageOption) continue;
        const text = normalizeDisplayText(element.textContent);
        if (!text.includes(label) || text.length > label.length + 20) continue;
        const roleScore = element.matches("button,[role='menuitem'],[role='option'],[data-radix-collection-item]") ? 0 : 10;
        const score = roleScore + text.length;
        if (score < bestScore) {
          best = element;
          bestScore = score;
        }
      }
      return best;
    }

    function findLanguageTemplate(container) {
      let template = null;
      for (const label of officialLanguageLabels) {
        const item = findLanguageItem(container, label);
        if (item) template = item;
      }
      return template;
    }

    function collectLanguageMenuContainers(menu, template) {
      const containers = new Set([menu, template.parentElement].filter(Boolean));
      let current = menu;
      for (let depth = 0; current && current !== document.body && depth < 8; depth += 1) {
        const rect = elementRect(current);
        const text = normalizeDisplayText(current.textContent);
        if (rect && rect.width <= 900 && rect.height <= 1100 && countOfficialLanguageLabels(text) >= 5) {
          containers.add(current);
        }
        current = current.parentElement;
      }
      const list = [...containers].filter(Boolean);
      const chineseActive = activeLang === "zh-CN" || activeLang === "zh-TW";
      for (const container of list) {
        container.dataset.claudeZhCnLanguageMenu = "true";
        container.dataset.claudeZhCnChineseActive = chineseActive ? "true" : "false";
      }
      return list;
    }

    function largestVisibleContainer(containers) {
      let best = null;
      let bestArea = -1;
      for (const container of containers) {
        const rect = elementRect(container);
        if (!rect) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = container;
          bestArea = area;
        }
      }
      return best;
    }

    function activateLanguageOption(event, lang) {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      setActiveLang(lang, true);
      restoreOfficialEnglishLanguage();
      window.setTimeout(() => {
        try {
          document.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true
          }));
        } catch {}
      }, 0);
    }

    function updateLanguageOption(option, lang) {
      const selected = officialEnglishSelected && activeLang === lang;
      const label = languageLabels[lang];
      const rendered = label + "|" + (selected ? "1" : "0");
      option.setAttribute("aria-label", label);
      option.setAttribute("aria-selected", selected ? "true" : "false");
      option.setAttribute("aria-checked", selected ? "true" : "false");
      if (option.dataset.claudeZhCnRendered === rendered) return;
      option.dataset.claudeZhCnRendered = rendered;
      option.textContent = "";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const checkNode = document.createElement("span");
      checkNode.textContent = selected ? "✓" : "";
      checkNode.setAttribute("aria-hidden", "true");
      checkNode.style.marginLeft = "auto";
      checkNode.style.color = "#2563eb";
      option.append(labelNode, checkNode);
      option.style.display = "flex";
      option.style.alignItems = "center";
      option.style.justifyContent = "space-between";
      option.style.gap = "16px";
      option.style.cursor = "default";
    }

    function ensureLanguageOption(parent, template, lang) {
      let option = parent.querySelector("[data-claude-zh-cn-language-option='" + lang + "']");
      if (!option) {
        option = template.cloneNode(false);
        option.removeAttribute("id");
        option.removeAttribute("aria-current");
        option.dataset.claudeZhCnLanguageOption = lang;
        option.dataset.claudeZhCnGenerated = "true";
        if (!option.getAttribute("role")) option.setAttribute("role", template.getAttribute("role") || "menuitem");
        if (!option.getAttribute("tabindex")) option.setAttribute("tabindex", template.getAttribute("tabindex") || "-1");
        option.addEventListener("click", (event) => activateLanguageOption(event, lang), true);
        option.addEventListener("keydown", (event) => activateLanguageOption(event, lang), true);
        parent.appendChild(option);
      }
      updateLanguageOption(option, lang);
    }

    function updateLanguageMenuChecks() {
      for (const option of document.querySelectorAll?.("[data-claude-zh-cn-language-option]") || []) {
        updateLanguageOption(option, option.dataset.claudeZhCnLanguageOption);
      }
    }

    function ensureLanguageMenuStyle() {
      if (document.getElementById("claude-zh-cn-language-menu-style")) return;
      const style = document.createElement("style");
      style.id = "claude-zh-cn-language-menu-style";
      style.textContent = [
        "[data-claude-zh-cn-hidden-english='true'] { display: none !important; }",
        "[data-claude-zh-cn-hidden-english-check='true'] { visibility: hidden !important; opacity: 0 !important; }"
      ].join("\\n");
      document.head?.appendChild(style);
    }

    function isSvgElement(element) {
      return String(element?.tagName || "").toLowerCase() === "svg";
    }

    function trackOfficialLanguageChoice(event) {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      const label = event.currentTarget?.dataset?.claudeZhCnOfficialLanguageLabel;
      if (!label) return;
      setOfficialSelectedLabel(label);
    }

    function ensureOfficialLanguageTracking(row, label) {
      row.dataset.claudeZhCnOfficialLanguageLabel = label;
      if (row.dataset.claudeZhCnOfficialTrackingBound === "true") return;
      row.dataset.claudeZhCnOfficialTrackingBound = "true";
      row.addEventListener("click", trackOfficialLanguageChoice, true);
      row.addEventListener("keydown", trackOfficialLanguageChoice, true);
    }

    function setEnglishCheckHidden(element, hidden) {
      if (!element || !element.style || !element.dataset) return;
      if (hidden) {
        if (!element.dataset.claudeZhCnOriginalVisibility) {
          element.dataset.claudeZhCnOriginalVisibility = element.style.visibility || "__empty__";
        }
        element.style.visibility = "hidden";
        element.dataset.claudeZhCnHiddenEnglishCheck = "true";
        return;
      }
      if (element.dataset.claudeZhCnHiddenEnglishCheck !== "true") return;
      const original = element.dataset.claudeZhCnOriginalVisibility;
      element.style.visibility = original && original !== "__empty__" ? original : "";
      delete element.dataset.claudeZhCnOriginalVisibility;
      delete element.dataset.claudeZhCnHiddenEnglishCheck;
    }

    function findLanguageRow(root, item, label) {
      const rootRect = elementRect(root);
      let row = item;
      for (let current = item; current && current !== document.body; current = current.parentElement) {
        const rect = elementRect(current);
        const text = normalizeDisplayText(current.textContent);
        if (
          rect
          && text.includes(label)
          && text.length <= label.length + 20
          && rect.height >= 18
          && rect.height <= 72
          && (!rootRect || rect.width >= rootRect.width * 0.45)
        ) {
          row = current;
        }
        if (current === root) break;
      }
      return row;
    }

    function rowSelectionAttribute(row) {
      const values = [
        row.getAttribute("aria-selected"),
        row.getAttribute("aria-checked"),
        row.getAttribute("aria-current"),
        row.getAttribute("data-state"),
        row.getAttribute("data-selected")
      ].filter((value) => value !== null && value !== undefined).map((value) => String(value).toLowerCase());
      return values.some((value) => value === "" || ["true", "checked", "selected", "active", "page"].includes(value));
    }

    function likelyCheckCandidate(candidate, rect, rootRect) {
      if (!isElementVisible(candidate)) return false;
      const text = normalizeDisplayText(candidate.textContent);
      const aria = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.getAttribute("data-state"),
        candidate.getAttribute("data-selected"),
        candidate.getAttribute("aria-selected"),
        candidate.getAttribute("aria-checked"),
        candidate.className
      ].filter(Boolean).join(" ").toLowerCase();
      const checkText = text === "✓" || text === "✔" || text === "√";
      const checkLike = isSvgElement(candidate)
        || checkText
        || rowSelectionAttribute(candidate)
        || /check|checked|selected|active/.test(aria);
      if (!checkLike) return false;
      const smallEnough = rect.width <= 56 && rect.height <= 56;
      if (!smallEnough) return false;
      return rect.left >= rootRect.left + rootRect.width * 0.52 || rect.right >= rootRect.right - 72;
    }

    function rectAlignsWithAnyLanguageOption(root, rect) {
      for (const option of root.querySelectorAll?.("[data-claude-zh-cn-language-option]") || []) {
        const optionRect = elementRect(option);
        if (rectAlignsWithRow(rect, optionRect)) return true;
      }
      return false;
    }

    function selectedOfficialLabelFromAttributes(root) {
      const selector = [
        "[data-state='checked']",
        "[data-selected]",
        "[aria-selected='true']",
        "[aria-checked='true']",
        "[aria-current]"
      ].join(",");
      for (const candidate of root.querySelectorAll?.(selector) || []) {
        if (candidate.closest("[data-claude-zh-cn-language-option]")) continue;
        if (!isElementVisible(candidate)) continue;
        const text = normalizeDisplayText(candidate.textContent);
        for (const label of officialLanguageLabels) {
          if (text.includes(label) && text.length <= label.length + 80) return label;
        }
      }
      return "";
    }

    function visibleOfficialCheckLabel(root, rows) {
      const rootRect = elementRect(root);
      if (!rootRect || !document.querySelectorAll) return "";
      const englishRow = rows.find((entry) => entry.label === officialLanguageLabels[0])?.row;
      const englishRect = elementRect(englishRow);
      const selector = [
        "svg",
        "span",
        "div",
        "[data-state='checked']",
        "[data-selected]",
        "[aria-selected='true']",
        "[aria-checked='true']",
        "[aria-current]",
        "[aria-label='Check']",
        "[aria-label='Selected']",
        "[aria-label='✓']"
      ].join(",");
      for (const candidate of document.querySelectorAll(selector)) {
        if (candidate.closest("[data-claude-zh-cn-language-option]")) continue;
        const rect = elementRect(candidate);
        if (!rect || !rectNearContainer(rootRect, rect)) continue;
        if (!likelyCheckCandidate(candidate, rect, rootRect)) continue;
        if (rectAlignsWithRow(rect, englishRect)) continue;
        if (rectAlignsWithAnyLanguageOption(root, rect)) continue;
        for (const entry of rows) {
          if (entry.label === officialLanguageLabels[0]) continue;
          if (rectAlignsWithRow(rect, elementRect(entry.row))) return entry.label;
        }
        return officialNonEnglishStorageValue;
      }
      return "";
    }

    function checkCandidateSelectedForRow(root, row) {
      const rootRect = elementRect(root);
      const rowRect = elementRect(row);
      if (!rootRect || !rowRect || !document.querySelectorAll) return false;
      const selector = [
        "svg",
        "span",
        "div",
        "[data-state='checked']",
        "[data-selected]",
        "[aria-selected='true']",
        "[aria-checked='true']",
        "[aria-current]",
        "[aria-label='Check']",
        "[aria-label='Selected']",
        "[aria-label='✓']"
      ].join(",");
      const rowCenter = rowRect.top + rowRect.height / 2;
      for (const candidate of document.querySelectorAll(selector)) {
        if (candidate.closest("[data-claude-zh-cn-language-option]")) continue;
        const rect = elementRect(candidate);
        if (!rect || !rectContains(rootRect, rect)) continue;
        const text = normalizeDisplayText(candidate.textContent);
        const checkLike = isSvgElement(candidate) || !text || text === "✓" || text === "✔" || text === "√";
        if (!checkLike) continue;
        const smallEnough = rect.width <= 42 && rect.height <= 42;
        if (!smallEnough) continue;
        const rightSide = rect.left >= rootRect.left + rootRect.width * 0.58;
        const sameRow = Math.abs(rectCenterY(rect) - rowCenter) <= Math.max(24, rowRect.height * 0.65);
        if (rightSide && sameRow) return true;
      }
      return false;
    }

    function detectOfficialSelectedLabel(root, rows) {
      for (const entry of rows) {
        if (rowSelectionAttribute(entry.row)) return entry.label;
      }
      const selectedByAttribute = selectedOfficialLabelFromAttributes(root);
      if (selectedByAttribute) return selectedByAttribute;
      for (const entry of rows) {
        if (checkCandidateSelectedForRow(root, entry.row)) return entry.label;
      }
      const selectedByVisibleCheck = visibleOfficialCheckLabel(root, rows);
      if (selectedByVisibleCheck) return selectedByVisibleCheck;
      return "";
    }

    function syncHiddenEnglishCheck(root, englishRow, hidden) {
      for (const element of document.querySelectorAll?.("[data-claude-zh-cn-hidden-english-check='true']") || []) {
        setEnglishCheckHidden(element, false);
      }
      if (!hidden || !englishRow) return;
      const wasHidden = englishRow.dataset.claudeZhCnHiddenEnglish === "true";
      if (wasHidden) delete englishRow.dataset.claudeZhCnHiddenEnglish;
      const rootRect = elementRect(root);
      const rowRect = elementRect(englishRow);
      if (wasHidden) englishRow.dataset.claudeZhCnHiddenEnglish = "true";
      if (!rootRect || !rowRect || !document.querySelectorAll) return;
      const rowCenter = rowRect.top + rowRect.height / 2;
      const selector = [
        "svg",
        "span",
        "div",
        "[data-state='checked']",
        "[data-selected]",
        "[aria-label='Check']",
        "[aria-label='Selected']",
        "[aria-label='✓']"
      ].join(",");
      for (const candidate of document.querySelectorAll(selector)) {
        if (candidate.closest("[data-claude-zh-cn-language-option]")) continue;
        const rect = elementRect(candidate);
        if (!rect || !rectContains(rootRect, rect)) continue;
        const text = normalizeDisplayText(candidate.textContent);
        const checkLike = isSvgElement(candidate) || !text || text === "✓" || text === "✔" || text === "√";
        const smallEnough = rect.width <= 42 && rect.height <= 42;
        if (!smallEnough) continue;
        const rightSide = rect.left >= rootRect.left + rootRect.width * 0.58;
        const sameRow = Math.abs((rect.top + rect.height / 2) - rowCenter) <= Math.max(24, rowRect.height * 0.65);
        if (checkLike && rightSide && sameRow) setEnglishCheckHidden(candidate, true);
      }
    }

    function dispatchMouseSequence(element) {
      const rect = elementRect(element);
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect ? rect.left + rect.width / 2 : 0,
        clientY: rect ? rect.top + rect.height / 2 : 0
      };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        try {
          element.dispatchEvent(new MouseEvent(type, eventInit));
        } catch {}
      }
    }

    function restoreOfficialEnglishLanguage() {
      const menu = findLanguageMenu();
      if (!menu) return;
      const template = findLanguageTemplate(menu);
      const containers = template ? collectLanguageMenuContainers(menu, template) : [menu];
      const root = largestVisibleContainer(containers) || menu;
      const item = findLanguageItem(root, officialLanguageLabels[0]) || findLanguageItem(menu, officialLanguageLabels[0]);
      if (!item) return;
      const row = findLanguageRow(root, item, officialLanguageLabels[0]);
      row.dataset.claudeZhCnRestoringOfficialEnglish = "true";
      officialEnglishRestorePendingUntil = Date.now() + 2500;
      setOfficialSelectedLabel(officialLanguageLabels[0]);
      window.setTimeout(() => {
        try {
          const wasHidden = row.dataset.claudeZhCnHiddenEnglish === "true";
          if (wasHidden) delete row.dataset.claudeZhCnHiddenEnglish;
          dispatchMouseSequence(row);
          if (typeof row.click === "function") row.click();
          if (wasHidden) row.dataset.claudeZhCnHiddenEnglish = "true";
        } catch {}
        window.setTimeout(() => {
          try { delete row.dataset.claudeZhCnRestoringOfficialEnglish; } catch {}
        }, 300);
      }, 0);
    }

    function syncOfficialLanguageSelection(menu, containers) {
      const chineseActive = activeLang === "zh-CN" || activeLang === "zh-TW";
      ensureLanguageMenuStyle();
      const root = largestVisibleContainer(containers) || menu;
      const rows = [];
      const storedLocale = getStoredOfficialLocale();
      for (const container of containers) {
        container.dataset.claudeZhCnChineseActive = chineseActive ? "true" : "false";
      }
      for (const label of officialLanguageLabels) {
        const item = findLanguageItem(root, label) || findLanguageItem(menu, label);
        if (!item) continue;
        const row = findLanguageRow(root, item, label);
        row.dataset.claudeZhCnOfficialLanguageRow = "true";
        row.dataset.claudeZhCnChineseActive = chineseActive ? "true" : "false";
        ensureOfficialLanguageTracking(row, label);
        delete row.dataset.claudeZhCnHiddenEnglish;
        rows.push({ label, row });
      }
      const selectedLabel = detectOfficialSelectedLabel(root, rows);
      if (Date.now() < officialEnglishRestorePendingUntil) {
        officialEnglishSelected = true;
      } else if (storedLocale && storedLocale !== "en-US") {
        setOfficialSelectedLabel(officialLanguageLabelByLocale[storedLocale] || officialNonEnglishStorageValue);
      } else if (selectedLabel) {
        setOfficialSelectedLabel(selectedLabel);
      } else {
        officialEnglishSelected = getStoredOfficialEnglishSelected();
      }
      const englishRow = rows.find((entry) => entry.label === officialLanguageLabels[0])?.row;
      if (englishRow) englishRow.dataset.claudeZhCnHiddenEnglish = "true";
      syncHiddenEnglishCheck(root, englishRow, officialEnglishSelected);
      updateLanguageMenuChecks();
    }

    function enhanceLanguageMenus() {
      const menu = findLanguageMenu();
      if (!menu) return;
      const template = findLanguageTemplate(menu);
      if (!template || !template.parentElement) return;
      const containers = collectLanguageMenuContainers(menu, template);
      ensureLanguageOption(template.parentElement, template, "en-US");
      ensureLanguageOption(template.parentElement, template, "zh-CN");
      ensureLanguageOption(template.parentElement, template, "zh-TW");
      syncOfficialLanguageSelection(menu, containers);
    }

    function translateTree(root = document.body) {
      if (!root) return;
      translateNode(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) translateNode(current);
    }

    function start() {
      if (!document.documentElement) {
        window.setTimeout(start, 50);
        return;
      }
      setLang();
      translateTree(document.documentElement);
      enhanceLanguageMenus();
      new MutationObserver((mutations) => {
        let shouldEnhanceLanguageMenus = false;
        for (const mutation of mutations) {
          if (mutation.type === "characterData") translateNode(mutation.target);
          if (mutation.type === "attributes") translateNode(mutation.target);
          for (const node of mutation.addedNodes) {
            translateTree(node);
            shouldEnhanceLanguageMenus = true;
          }
        }
        if (shouldEnhanceLanguageMenus) enhanceLanguageMenus();
      }).observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: attrNames
      });
      window.setInterval(() => {
        translateTree(document.documentElement);
        enhanceLanguageMenus();
      }, 1500);
      console.debug(marker, "active");
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch (error) {
    try { console.debug(${JSON.stringify(MARKER)}, "failed", error && error.message); } catch {}
  }
})();\n`;
}

function writePatchedJson(file, data, backup, changes, options) {
  writeFileIfChanged(file, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8"), backup, changes, options);
}

function writeFileIfChanged(file, content, backup, changes, options) {
  const relativePath = path.relative(backup.resourcesPath, file);
  const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (current && Buffer.compare(current, content) === 0) return;

  backupFile(file, relativePath, backup, options);
  changes.push(relativePath);
  if (options.dryRun) return;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}

function createBackup(install, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const backupRoot = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const backupPath = path.join(backupRoot, `backup-${stamp}-${suffix}`);
  return {
    path: backupPath,
    resourcesPath: install.resourcesPath,
    files: new Map()
  };
}

function backupFile(file, relativePath, backup, options) {
  if (backup.files.has(relativePath)) return;
  const existed = fs.existsSync(file);
  const backupName = relativePath.replace(/[\\/]/g, "__");
  backup.files.set(relativePath, { relativePath, existed, backupName });
  if (options.dryRun) return;
  ensureDir(backup.path);
  if (existed) fs.copyFileSync(file, path.join(backup.path, backupName));
}

function writeManifest(backup, install, changes, catalog, languageCatalogs = [catalog]) {
  ensureDir(backup.path);
  const manifest = {
    tool: "claude-zh",
    version: require("../package.json").version,
    createdAt: new Date().toISOString(),
    appPath: install.appPath,
    resourcesPath: install.resourcesPath,
    locale: catalog.locale,
    lang: catalog.lang,
    languages: languageCatalogs.map((entry) => entry.lang),
    files: [...backup.files.values()],
    changes
  };
  fs.writeFileSync(path.join(backup.path, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function findBackup(resourcesPath, backupDir = DEFAULT_BACKUP_DIR, mode = "latest") {
  const backups = listBackups(resourcesPath, backupDir);
  const selected = mode === "earliest" ? backups[backups.length - 1] : backups[0];
  return selected?.path || null;
}

function listBackups(resourcesPath, backupDir = DEFAULT_BACKUP_DIR) {
  const root = path.resolve(backupDir);
  if (!safeIsDirectory(root)) return [];
  return fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((candidate) => safeIsDirectory(candidate) && fs.existsSync(path.join(candidate, "manifest.json")))
    .map((candidate) => {
      try {
        return { path: candidate, manifest: readJson(path.join(candidate, "manifest.json")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => path.resolve(entry.manifest.resourcesPath) === path.resolve(resourcesPath))
    .sort((a, b) => String(b.manifest.createdAt).localeCompare(String(a.manifest.createdAt)));
}

function isPatched(resourcesPath) {
  return getPatchState(resourcesPath).patched;
}

function getPatchState(resourcesPath, catalog = createCatalog({ locale: "cn" })) {
  const checks = [
    path.join(resourcesPath, `${catalog.lang}.json`),
    path.join(resourcesPath, `ion-dist/i18n/${catalog.lang}.json`),
    path.join(resourcesPath, "ion-dist/assets/claude-zh-cn-dom.js")
  ];
  const externalResources = checks.some((file) => fs.existsSync(file));
  const preload = hasAsarPreloadPatch(resourcesPath, CURRENT_PRELOAD_MARKER);
  const legacyPreload = hasAsarPreloadPatch(resourcesPath, PRELOAD_MARKER_PREFIX);
  const asarFile = path.join(resourcesPath, "app.asar");
  const requiresPreload = fs.existsSync(asarFile) && isValidAsar(asarFile);
  return {
    externalResources,
    preload,
    legacyPreload,
    needsPreloadUpgrade: legacyPreload && !preload,
    patched: externalResources && (!requiresPreload || preload),
    partial: externalResources && requiresPreload && !preload
  };
}

function hasAsarPreloadPatch(resourcesPath, marker = CURRENT_PRELOAD_MARKER) {
  const asarFile = path.join(resourcesPath, "app.asar");
  if (!fs.existsSync(asarFile) || !isValidAsar(asarFile)) return false;
  try {
    return require("@electron/asar").extractFile(asarFile, ".vite/build/mainView.js").toString("utf8").includes(marker);
  } catch {
    return false;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function detectTextEncoding(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return "utf16le-bom";
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return "utf16be-bom";
  return "utf8";
}

function decodeText(buffer, encoding = detectTextEncoding(buffer)) {
  if (encoding === "utf16le-bom") return buffer.slice(2).toString("utf16le");
  if (encoding === "utf16be-bom") return swapUtf16Be(buffer.slice(2)).toString("utf16le");
  return buffer.toString("utf8");
}

function encodeText(text, encoding) {
  if (encoding === "utf16le-bom") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  }
  if (encoding === "utf16be-bom") {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), swapUtf16Be(Buffer.from(text, "utf16le"))]);
  }
  return Buffer.from(text, "utf8");
}

function swapUtf16Be(buffer) {
  const copy = Buffer.from(buffer);
  for (let index = 0; index + 1 < copy.length; index += 2) {
    const first = copy[index];
    copy[index] = copy[index + 1];
    copy[index + 1] = first;
  }
  return copy;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function pruneEmptyDirs(dir, stop) {
  let current = dir;
  const root = path.resolve(stop);
  while (path.resolve(current).startsWith(root) && path.resolve(current) !== root) {
    try {
      fs.rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPermissionError(error) {
  if (!["EACCES", "EPERM"].includes(error.code)) return error.message;
  const target = error.path || error.dest || error.claudeZhCnPath;
  const targetText = target ? `\n失败路径：${target}` : "";
  if (process.platform === "darwin" && error.code === "EPERM" && target && target.includes(".app/Contents")) {
    return [
      "权限不足。macOS 拦截了对 Claude.app 的修改。",
      "请到“系统设置 > 隐私与安全性 > App Management（应用管理）”允许你运行脚本的终端 App（Terminal、iTerm、VS Code 或 Codex），然后重新执行。",
      "如果仍失败，再把同一个终端 App 加到 Full Disk Access（完全磁盘访问）。",
      targetText.trim()
    ].filter(Boolean).join("\n");
  }
  if (process.platform === "win32") {
    return `权限不足。请用“以管理员身份运行”的终端重新执行脚本。${targetText}`;
  }
  return `权限不足。请用 sudo 重新执行脚本，或用 --app 指向当前用户可写的 Claude 安装目录。${targetText}`;
}

module.exports = {
  DEFAULT_BACKUP_DIR,
  applyPatch,
  detectCandidates,
  formatPermissionError,
  getStatus,
  _test: {
    managedWindowsPackageFullNameFromFullName,
    managedWindowsPackageFamilyNameFromFullName,
    packageFamilyNameFromFullName,
    patchWindowsManifestForManagedPackage,
    readWindowsApplicationId
  },
  launchPreview,
  resolveInstall,
  restorePatch
};

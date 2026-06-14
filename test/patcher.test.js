"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const asar = require("@electron/asar");
const crypto = require("node:crypto");

const { applyPatch, getStatus, launchPreview, resolveInstall, restorePatch, _test } = require("../src/patcher");
const { parseArgs } = require("../src/cli");
const { createCatalog } = require("../src/translations");

test("cli installs the full language menu by default", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, "apply");
  assert.equal(parsed.options.locale, "cn");
});

test("translates current settings usage and Claude Code pages", () => {
  const cn = createCatalog({ locale: "cn" });
  const tw = createCatalog({ locale: "tw" });

  assert.equal(cn.allPhrases["Plan usage limits"], "计划用量限制");
  assert.equal(cn.allPhrases["Classify session states"], "对会话状态进行分类");
  assert.equal(cn.allPhrases["Autofix pull requests"], "自动修复拉取请求");
  assert.equal(cn.allPhrases["Delete sessions stored by Anthropic"], "删除 Anthropic 保存的会话");
  assert.equal(cn.allPhrases["Claude in Chrome settings"], "Chrome 中的 Claude 设置");
  assert.equal(cn.allPhrases["Browser Use"], "浏览器使用");
  assert.equal(cn.allPhrases["Connected browsers"], "已连接的浏览器");
  assert.equal(cn.allPhrases["Computer use"], "电脑使用");
  assert.equal(cn.allPhrases["Denied apps"], "已拒绝的应用");
  assert.equal(cn.allPhrases["Open System Settings"], "打开系统设置");
  assert.equal(cn.patternPhrases.percentUsed, "已使用 $1%");
  assert.equal(cn.patternPhrases.resetsWed, "周三 $1 重置");
  assert.equal(cn.patternPhrases.connectedMinutesAgo, "$1 分钟前连接");
  assert.equal(cn.patternPhrases.showingRange, "显示第 $1-$2 项，共 $3 项");

  assert.equal(tw.allPhrases["Plan usage limits"], "計劃用量限制");
  assert.equal(tw.allPhrases["Classify session states"], "對工作階段狀態進行分類");
  assert.equal(tw.allPhrases["Claude in Chrome settings"], "Chrome 中的 Claude 設定");
  assert.equal(tw.allPhrases["Browser Use"], "瀏覽器使用");
  assert.equal(tw.allPhrases["Computer use"], "電腦使用");
});

test("patches an installed Claude resources directory in place and restores it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-"));
  const appPath = path.join(root, "Claude.app");
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const backupDir = path.join(root, "backups");
  await createFakeClaude(resourcesPath);

  const originalRootJson = fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8");
  const originalStrings = fs.readFileSync(path.join(resourcesPath, "en.lproj", "Localizable.strings"));
  const originalPublicJson = fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "en-US.json"), "utf8");
  const originalDynamicJson = fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "en-US.json"), "utf8");
  const originalHtml = fs.readFileSync(path.join(resourcesPath, "ion-dist", "index.html"), "utf8");
  const originalAsar = fs.readFileSync(path.join(resourcesPath, "app.asar"));

  const result = applyPatch({ app: appPath, backupDir });

  assert.equal(result.dryRun, false);
  assert.ok(result.changes.includes("en-US.json"));
  assert.ok(result.changes.includes("app.asar"));
  assert.ok(result.changes.includes(path.join("ion-dist", "assets", "claude-zh-cn-dom.js")));
  assert.notDeepEqual(fs.readFileSync(path.join(resourcesPath, "app.asar")), originalAsar);
  const patchedPreload = extractAsarFile(path.join(resourcesPath, "app.asar"), ".vite/build/mainView.js");
  assert.match(patchedPreload, /claude-zh-cn preload patch v27 zh-CN/);
  assert.match(patchedPreload, /executeJavaScript/);
  assert.match(patchedPreload, /claude-zh-cn-active-lang/);
  assert.match(patchedPreload, /claude-zh-cn-official-language/);
  assert.match(patchedPreload, /spa:locale/);
  assert.match(patchedPreload, /officialLanguageLocaleByLabel/);
  assert.match(patchedPreload, /fr-FR/);
  assert.match(patchedPreload, /it-IT/);
  assert.match(patchedPreload, /pt-BR/);
  assert.match(patchedPreload, /es-419/);
  assert.match(patchedPreload, /es-ES/);
  assert.match(patchedPreload, /claudeZhCnChineseActive/);
  assert.match(patchedPreload, /claude-zh-cn-hidden-english/);
  assert.match(patchedPreload, /claude-zh-cn-hidden-english-check/);
  assert.match(patchedPreload, /detectOfficialSelectedLabel/);
  assert.match(patchedPreload, /visibleOfficialCheckLabel/);
  assert.match(patchedPreload, /__claude_zh_cn_official_non_english__/);
  assert.match(patchedPreload, /restoreOfficialEnglishLanguage/);
  assert.match(patchedPreload, /en-US/);
  assert.match(patchedPreload, /English/);
  assert.match(patchedPreload, /简体中文/);
  assert.match(patchedPreload, /繁體中文/);
  if (process.platform === "darwin") {
    assert.equal(readIntegrityHash(appPath), getAsarHeaderHash(path.join(resourcesPath, "app.asar")));
  }

  const rootJson = JSON.parse(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8"));
  assert.equal(rootJson.S3k92gI8z, "新对话");
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh-CN.json")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh-TW.json")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(resourcesPath, "zh-TW.json"), "utf8")).S3k92gI8z, "新對話");

  const strings = readUtf16LeWithBom(path.join(resourcesPath, "en.lproj", "Localizable.strings"));
  assert.match(strings, /"Cancel" = "取消";/);
  assert.match(strings, /"New Chat" = "新对话";/);
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh_CN.lproj", "Localizable.strings")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh_TW.lproj", "Localizable.strings")));

  const publicJson = JSON.parse(fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "en-US.json"), "utf8"));
  assert.equal(publicJson.Ajmo3Cu3b, "开始新会话");
  assert.equal(publicJson.Ajmo, "新会话");
  assert.equal(publicJson.RLloCeiLx7, "描述一个任务或提个问题");
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "zh-CN.json")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "zh-TW.json")));

  const dynamicJson = JSON.parse(fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "en-US.json"), "utf8"));
  assert.equal(dynamicJson.DvRKnnUSOG, "思考中");
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "zh-CN.json")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "zh-TW.json")));

  const html = fs.readFileSync(path.join(resourcesPath, "ion-dist", "index.html"), "utf8");
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /claude-zh-cn-dom\.js/);
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "assets", "claude-zh-cn-dom.js")));

  const status = getStatus({ app: appPath, backupDir });
  assert.equal(status.length, 1);
  assert.equal(status[0].patched, true);

  const restored = restorePatch({ app: appPath, backup: result.backupPath });
  assert.ok(restored.restored.includes("en-US.json"));
  assert.equal(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8"), originalRootJson);
  assert.deepEqual(fs.readFileSync(path.join(resourcesPath, "en.lproj", "Localizable.strings")), originalStrings);
  assert.equal(fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "en-US.json"), "utf8"), originalPublicJson);
  assert.equal(fs.readFileSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "en-US.json"), "utf8"), originalDynamicJson);
  assert.equal(fs.readFileSync(path.join(resourcesPath, "ion-dist", "index.html"), "utf8"), originalHtml);
  assert.deepEqual(fs.readFileSync(path.join(resourcesPath, "app.asar")), originalAsar);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh-CN.json")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh-TW.json")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh_CN.lproj", "Localizable.strings")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh_TW.lproj", "Localizable.strings")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "ion-dist", "assets", "claude-zh-cn-dom.js")), false);
});

test("dry run reports changes without writing files or backups", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-dry-"));
  const resourcesPath = path.join(root, "resources");
  const backupDir = path.join(root, "backups");
  await createFakeClaude(resourcesPath);

  const before = fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8");
  const beforeAsar = fs.readFileSync(path.join(resourcesPath, "app.asar"));
  const result = applyPatch({ app: resourcesPath, backupDir, dryRun: true });

  assert.equal(result.dryRun, true);
  assert.ok(result.changes.length > 0);
  assert.equal(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8"), before);
  assert.deepEqual(fs.readFileSync(path.join(resourcesPath, "app.asar")), beforeAsar);
  assert.equal(fs.existsSync(result.backupPath), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh-CN.json")), false);
});

test("preview patches a temporary copy without modifying the source app", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-preview-"));
  const appPath = path.join(root, "Claude.app");
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const previewDir = path.join(root, "preview");
  await createFakeClaude(resourcesPath);

  const originalRootJson = fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8");
  const originalAsar = fs.readFileSync(path.join(resourcesPath, "app.asar"));

  const result = launchPreview({
    app: appPath,
    previewDir,
    noLaunch: true,
    verbose: true
  });

  assert.equal(result.launched, false);
  assert.equal(result.sourceAppPath, appPath);
  assert.notEqual(result.previewAppPath, appPath);
  assert.ok(result.userDataDir.endsWith(path.join("preview", "user-data")));
  assert.equal(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8"), originalRootJson);
  assert.deepEqual(fs.readFileSync(path.join(resourcesPath, "app.asar")), originalAsar);

  const previewResources = path.join(result.previewAppPath, "Contents", "Resources");
  const previewJson = JSON.parse(fs.readFileSync(path.join(previewResources, "en-US.json"), "utf8"));
  assert.equal(previewJson.S3k92gI8z, "新对话");
  assert.match(extractAsarFile(path.join(previewResources, "app.asar"), ".vite/build/mainView.js"), /claude-zh-cn preload patch v27 zh-CN/);
});

test("patches Taiwan traditional Chinese and restores default through the backup chain", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-tw-"));
  const appPath = path.join(root, "Claude.app");
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const backupDir = path.join(root, "backups");
  await createFakeClaude(resourcesPath);

  const originalRootJson = fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8");
  const originalAsar = fs.readFileSync(path.join(resourcesPath, "app.asar"));

  const cn = applyPatch({ app: appPath, backupDir, locale: "cn" });
  assert.equal(cn.lang, "zh-CN");
  assert.equal(JSON.parse(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8")).S3k92gI8z, "新对话");

  const tw = applyPatch({ app: appPath, backupDir, locale: "tw" });
  assert.equal(tw.lang, "zh-TW");
  assert.equal(JSON.parse(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8")).S3k92gI8z, "新對話");
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh-TW.json")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "zh_TW.lproj", "Localizable.strings")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "zh-TW.json")));
  assert.ok(fs.existsSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "zh-TW.json")));
  assert.match(fs.readFileSync(path.join(resourcesPath, "ion-dist", "index.html"), "utf8"), /lang="zh-TW"/);
  assert.match(extractAsarFile(path.join(resourcesPath, "app.asar"), ".vite/build/mainView.js"), /claude-zh-cn preload patch v27 zh-TW/);
  assert.equal(getStatus({ app: appPath, backupDir })[0].patched, true);

  const restored = restorePatch({ app: appPath, backupDir, restoreDefault: true });
  assert.equal(restored.restoreDefault, true);
  assert.equal(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8"), originalRootJson);
  assert.deepEqual(fs.readFileSync(path.join(resourcesPath, "app.asar")), originalAsar);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh-CN.json")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "zh-TW.json")), false);
  assert.equal(fs.existsSync(path.join(resourcesPath, "ion-dist", "assets", "claude-zh-cn-dom.js")), false);
});

test("resolves Windows Squirrel style app roots and exe paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-win-"));
  const oldResourcesPath = path.join(root, "app-1.0.0", "resources");
  const resourcesPath = path.join(root, "app-1.2.0", "resources");
  await createFakeClaude(oldResourcesPath);
  await createFakeClaude(resourcesPath);
  fs.writeFileSync(path.join(root, "app-1.2.0", "Claude.exe"), "");

  const fromRoot = resolveInstall(root);
  assert.equal(fromRoot.resourcesPath, resourcesPath);
  assert.equal(fromRoot.appPath, path.dirname(resourcesPath));

  const fromExe = resolveInstall(path.join(root, "app-1.2.0", "Claude.exe"));
  assert.equal(fromExe.resourcesPath, resourcesPath);
  assert.equal(fromExe.appPath, path.dirname(resourcesPath));
});

test("resolves Windows Store style Claude package app directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-store-"));
  const packageRoot = path.join(root, "WindowsApps", "Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc");
  const appRoot = path.join(packageRoot, "app");
  const resourcesPath = path.join(appRoot, "resources");
  await createFakeClaude(resourcesPath);

  const fromPackage = resolveInstall(packageRoot);
  assert.equal(fromPackage.resourcesPath, resourcesPath);
  assert.equal(fromPackage.appPath, appRoot);

  const fromApp = resolveInstall(appRoot);
  assert.equal(fromApp.resourcesPath, resourcesPath);
  assert.equal(fromApp.appPath, appRoot);
});

test("builds Windows Store package family names", () => {
  assert.equal(
    _test.packageFamilyNameFromFullName("Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc"),
    "Claude_pzs8sxrjxfjjc"
  );
  assert.equal(
    _test.managedWindowsPackageFamilyNameFromFullName("Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc"),
    "ClaudeCN_pzs8sxrjxfjjc"
  );
  assert.equal(
    _test.managedWindowsPackageFullNameFromFullName("Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc"),
    "ClaudeCN_1.12603.1.0_arm64__pzs8sxrjxfjjc"
  );
});

test("rewrites Windows Store manifest identity for the managed copy", () => {
  const manifest = [
    '<Package xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">',
    '<Identity Name="Claude" Publisher="CN=Anthropic" Version="1.0.0.0" />',
    "<Properties><DisplayName>Claude</DisplayName><Description>Claude</Description></Properties>",
    '<Applications><Application Id="Claude"><uap:VisualElements DisplayName="Claude" Description="Claude" /></Application></Applications>',
    "</Package>"
  ].join("");
  const patched = _test.patchWindowsManifestForManagedPackage(manifest, "ClaudeCN");

  assert.match(patched, /<Identity Name="ClaudeCN"/);
  assert.match(patched, /<DisplayName>Claude CN<\/DisplayName>/);
  assert.match(patched, /<Description>Claude CN<\/Description>/);
  assert.match(patched, /<uap:VisualElements DisplayName="Claude CN" Description="Claude CN"/);
});

test("patches Windows Store installs in place after unlocking", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-winapps-"));
  const packageRoot = path.join(root, "WindowsApps", "Claude_1.12603.1.0_arm64__pzs8sxrjxfjjc");
  const appRoot = path.join(packageRoot, "app");
  const resourcesPath = path.join(appRoot, "resources");
  await createFakeClaude(resourcesPath);
  fs.writeFileSync(path.join(packageRoot, "AppxManifest.xml"), '<Package><Applications><Application Id="Claude" /></Applications></Package>');

  const result = applyPatch({
    app: packageRoot,
    backupDir: path.join(root, "backups"),
    forceWindowsAppsInPlace: true,
    noLaunch: true,
    skipClose: true,
    skipShortcut: true
  });

  assert.equal(result.windowsAppsInPlace, true);
  assert.equal(result.appPath, appRoot);
  assert.equal(result.resourcesPath, resourcesPath);
  assert.equal(result.launched, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(resourcesPath, "en-US.json"), "utf8")).S3k92gI8z, "新对话");
  assert.match(extractAsarFile(path.join(resourcesPath, "app.asar"), ".vite/build/mainView.js"), /claude-zh-cn preload patch v27 zh-CN/);
});

async function createFakeClaude(resourcesPath) {
  fs.mkdirSync(path.join(resourcesPath, "en.lproj"), { recursive: true });
  fs.mkdirSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic"), { recursive: true });
  fs.mkdirSync(path.join(resourcesPath, "ion-dist", "assets"), { recursive: true });

  await createFakeAsar(path.join(resourcesPath, "app.asar"));
  writeFakeInfoPlist(path.resolve(resourcesPath, "../Info.plist"), path.join(resourcesPath, "app.asar"));
  fs.writeFileSync(path.join(resourcesPath, "en-US.json"), JSON.stringify({
    S3k92gI8z: "New chat",
    EHe4T9l3Uf: "Settings",
    untouched: "Keep this"
  }, null, 2));
  writeUtf16LeWithBom(path.join(resourcesPath, "en.lproj", "Localizable.strings"), [
    '"Cancel" = "Cancel";',
    '"New Chat" = "New Chat";'
  ].join("\n"));
  fs.writeFileSync(path.join(resourcesPath, "ion-dist", "i18n", "en-US.json"), JSON.stringify({
    Ajmo3Cu3b: "Start a new session",
    Ajmo: "New session",
    RLloCeiLx7: "Describe a task or ask a question"
  }, null, 2));
  fs.writeFileSync(path.join(resourcesPath, "ion-dist", "i18n", "dynamic", "en-US.json"), JSON.stringify({
    DvRKnnUSOG: "Thinking"
  }, null, 2));
  fs.writeFileSync(path.join(resourcesPath, "ion-dist", "index.html"), [
    '<!doctype html><html lang="en"><head>',
    '<meta name="description" content="Claude is Anthropic\'s AI, built for problem solvers. Tackle complex challenges, analyze data, write code, and think through your hardest work.">',
    "</head><body><div id=\"root\"></div></body></html>"
  ].join(""));
}

function writeFakeInfoPlist(file, asarFile) {
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ElectronAsarIntegrity</key>
  <dict>
    <key>Resources/app.asar</key>
    <dict>
      <key>algorithm</key>
      <string>SHA256</string>
      <key>hash</key>
      <string>${getAsarHeaderHash(asarFile)}</string>
    </dict>
  </dict>
</dict>
</plist>
`);
}

function readIntegrityHash(appPath) {
  const plist = fs.readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8");
  const match = plist.match(/<key>hash<\/key>\s*<string>([^<]+)<\/string>/);
  assert.ok(match);
  return match[1];
}

function getAsarHeaderHash(file) {
  const { headerString } = asar.getRawHeader(file);
  return crypto.createHash("sha256").update(headerString).digest("hex");
}

async function createFakeAsar(file) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-zh-cn-asar-src-"));
  fs.mkdirSync(path.join(root, ".vite", "build"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ main: ".vite/build/index.js" }));
  fs.writeFileSync(path.join(root, ".vite", "build", "mainView.js"), [
    '"use strict";',
    "document.documentElement.dataset.fakeClaude = '1';",
    "//# sourceMappingURL=mainView.js.map"
  ].join("\n"));
  await asar.createPackage(root, file);
  fs.rmSync(root, { recursive: true, force: true });
}

function extractAsarFile(file, name) {
  return asar.extractFile(file, name).toString("utf8");
}

function writeUtf16LeWithBom(file, text) {
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
}

function readUtf16LeWithBom(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer[0], 0xff);
  assert.equal(buffer[1], 0xfe);
  return buffer.slice(2).toString("utf16le");
}

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageFile = path.join(root, "package.json");
const backupFile = path.join(root, ".package.json.claude-zh-backup");
const mode = process.env.CLAUDE_ZH_DEFAULT_MODE;

if (!mode) process.exit(0);
if (!["cn", "tw", "default"].includes(mode)) {
  throw new Error(`CLAUDE_ZH_DEFAULT_MODE must be cn, tw, or default. Got: ${mode}`);
}

if (!fs.existsSync(backupFile)) {
  fs.copyFileSync(packageFile, backupFile);
}

const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
pkg.claudeZhDefaultMode = mode;
fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);

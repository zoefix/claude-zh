#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageFile = path.join(root, "package.json");
const backupFile = path.join(root, ".package.json.claude-zh-backup");

if (!fs.existsSync(backupFile)) process.exit(0);

fs.copyFileSync(backupFile, packageFile);
fs.unlinkSync(backupFile);

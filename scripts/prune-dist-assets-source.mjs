#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const target = path.resolve(".output/public/assets-source");

if (!fs.existsSync(target)) {
  process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
console.log("[postbuild] removed .output/public/assets-source");


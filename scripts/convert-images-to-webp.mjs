#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const WEBP_QUALITY = Number(process.env.WEBP_QUALITY ?? "85");
const DEST_DIR = process.env.IMAGES_DEST ?? "public/assets/images";

const sourceCandidates = [
  process.env.IMAGES_SOURCE,
  "assets-source/Images",
  "public/assets-source/Images",
].filter(Boolean);

function findSourceDir() {
  for (const candidate of sourceCandidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listImageFiles(dir, baseDir = dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listImageFiles(fullPath, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) continue;

    out.push({
      fullPath,
      relativePath: path.relative(baseDir, fullPath),
      ext,
    });
  }
  return out;
}

function isUpToDate(source, target) {
  if (!fs.existsSync(target)) return false;
  const sourceMtime = fs.statSync(source).mtimeMs;
  const targetMtime = fs.statSync(target).mtimeMs;
  return targetMtime >= sourceMtime;
}

async function main() {
  const sourceDir = findSourceDir();

  if (!sourceDir) {
    console.log(
      "[assets:convert] aucun dossier source trouvé. " +
      "Attendu: assets-source/Images ou public/assets-source/Images"
    );
    return;
  }

  ensureDir(DEST_DIR);
  const files = listImageFiles(sourceDir);

  let converted = 0;
  let copied = 0;
  let skipped = 0;

  for (const file of files) {
    const outputRelative = file.relativePath.replace(/\.[^.]+$/, ".webp");
    const outputPath = path.join(DEST_DIR, outputRelative);

    ensureDir(path.dirname(outputPath));

    if (isUpToDate(file.fullPath, outputPath)) {
      skipped++;
      continue;
    }

    if (file.ext === ".webp") {
      fs.copyFileSync(file.fullPath, outputPath);
      copied++;
      continue;
    }

    await sharp(file.fullPath).webp({ quality: WEBP_QUALITY }).toFile(outputPath);
    converted++;
  }

  console.log(
    `[assets:convert] source=${sourceDir} | converted=${converted} copied=${copied} skipped=${skipped}`
  );
}

main().catch((error) => {
  console.error("[assets:convert] erreur:", error);
  process.exit(1);
});


/**
 * `toolgate migrate` — codemod for legacy Middleware-style policy configs.
 *
 * Defaults to a dry run (report only). Pass --write to apply changes.
 * This module pulls in `typescript`, so cli.ts imports it lazily — the `run`
 * hot path never loads it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrateSource, type MigrateResult } from "./migrate";

const DEFAULT_TARGETS = ["toolgate.config.ts", "toolgate.config.local.ts"];

export async function migrateCmd(args: string[]): Promise<void> {
  const write = args.includes("--write");
  const paths = args.filter((a) => !a.startsWith("--"));
  const targets = paths.length > 0 ? paths : DEFAULT_TARGETS;

  let anyChanged = false;
  let anySkipped = false;
  let processed = 0;

  for (const target of targets) {
    const abs = resolve(process.cwd(), target);
    let code: string;
    try {
      code = await readFile(abs, "utf-8");
    } catch {
      // Only complain about explicitly-named files; skip absent defaults.
      if (paths.length > 0) console.error(`  ✗ ${target}: not found`);
      continue;
    }
    processed++;

    const result = migrateSource(code);
    report(target, result);

    if (result.status === "migrated") {
      anyChanged = true;
      if (write) {
        await writeFile(abs, result.code, "utf-8");
        console.log(`  ✎ wrote ${target}`);
      }
    }
    if (result.status === "skipped") anySkipped = true;
  }

  if (processed === 0) {
    console.error(
      "No config files found. Pass a path, or run from a directory with " +
        "toolgate.config.ts.",
    );
    process.exit(1);
  }

  if (!write && anyChanged) {
    console.log("\nDry run — re-run with --write to apply.");
  }
  if (anySkipped) process.exit(2);
}

function report(target: string, r: MigrateResult): void {
  const badge =
    r.status === "migrated" ? "→" : r.status === "skipped" ? "⚠" : "·";
  console.log(`\n${badge} ${target}`);

  if (r.status === "unchanged" && r.policies.length === 0) {
    console.log("  already action-based (or no legacy policies) — nothing to do");
  }

  if (r.removedImports.length > 0) {
    console.log(`  imports: drop ${r.removedImports.join(", ")}`);
  }

  for (const p of r.policies) {
    const mark = p.action ? "  •" : "  ⚠";
    console.log(`${mark} ${p.name}: ${p.detail}`);
  }

  for (const w of r.warnings) {
    console.log(`  ⚠ ${w}`);
  }
}

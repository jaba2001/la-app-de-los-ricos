// Regression guard for the CSS system: fails if an inline style block reappears that
// is exactly covered by an existing utility class. Keeps the inline-style debt from
// creeping back after the globals.css migration. Run: node scripts/css-lint.mjs
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const DIRS = ["components", "app"];

// Exact inline blocks that now have a class — using them inline is a regression.
const BANNED = [
  [`style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}`, "sr-tile"],
  [`style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}`, "sr-tile-label"],
  [`style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}`, "sr-hint"],
  [`style={{ fontSize: "10px", color: "var(--sr-text-3)" }}`, "sr-hint"],
  [`style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)" }}`, "sr-grid-4"],
  [`style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}`, "sr-grid-3"],
  [`style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--sr-sp-3)" }}`, "sr-grid-2"],
  [`style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sr-sp-3)" }}`, "sr-grid-5"],
  [`style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}`, "sr-flex-between"],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const findings = [];
for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    for (const [pattern, cls] of BANNED) {
      let idx = src.indexOf(pattern);
      while (idx !== -1) {
        const line = src.slice(0, idx).split("\n").length;
        findings.push(`${file.replace(ROOT + "\\", "").replace(/\\/g, "/")}:${line} — use className="${cls}" instead of this inline block`);
        idx = src.indexOf(pattern, idx + 1);
      }
    }
  }
}

if (findings.length) {
  console.error(`✗ css-lint: ${findings.length} inline block(s) that should be a utility class:`);
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log("✓ css-lint: no inline blocks that duplicate a utility class");

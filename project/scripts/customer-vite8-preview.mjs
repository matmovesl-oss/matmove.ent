import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(label, args, timeout = 180000) {
  const result = spawnSync(npm, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true
  });
  console.log("MATMOVE_CUSTOMER_VITE8_COMMAND " + label + " status=" + result.status + " signal=" + (result.signal || "none"));
  if (result.error) console.log("MATMOVE_CUSTOMER_VITE8_ERROR " + label + " " + result.error.message);
  if (result.stderr) console.log("MATMOVE_CUSTOMER_VITE8_STDERR " + label + " " + result.stderr.slice(-3000));
  return result;
}

const install = run("install-vite8", [
  "install",
  "--save-dev",
  "vite@^8.3.8",
  "@vitejs/plugin-react@^6.3.0",
  "esbuild@0.28.2",
  "--no-audit",
  "--no-fund"
]);
if (install.status !== 0) process.exit(install.status ?? 1);

const repair = run("npm-audit-fix-safe", ["audit", "fix", "--no-fund"], 180000);
console.log("MATMOVE_CUSTOMER_VITE8_AUDIT_FIX_EXIT " + String(repair.status));

await mkdir("public", { recursive: true });
await copyFile("package.json", "public/matmove-customer-vite8-package.json");
await copyFile("package-lock.json", "public/matmove-customer-vite8-package-lock.json");

const lock = await readFile("package-lock.json");
console.log("MATMOVE_CUSTOMER_VITE8_LOCK_SHA256 " + createHash("sha256").update(lock).digest("hex"));
console.log("MATMOVE_CUSTOMER_VITE8_LOCK_BYTES " + lock.byteLength);

const reports = [];
function audit(label, args) {
  const result = run(label, args, 90000);
  let report;
  try {
    report = JSON.parse(result.stdout || "");
  } catch {
    reports.push({
      label,
      available: false,
      exitStatus: result.status,
      error: (result.stderr || result.stdout || "").slice(-3000)
    });
    console.log("MATMOVE_CUSTOMER_VITE8_AUDIT_UNAVAILABLE " + label);
    return;
  }
  reports.push({ label, available: true, exitStatus: result.status, report });
  console.log("MATMOVE_CUSTOMER_VITE8_AUDIT_COUNTS " + label + " " + JSON.stringify(report.metadata?.vulnerabilities || {}));
  for (const [name, item] of Object.entries(report.vulnerabilities || {})) {
    console.log("MATMOVE_CUSTOMER_VITE8_AUDIT_ITEM " + JSON.stringify({
      label,
      name,
      severity: item.severity,
      direct: item.isDirect,
      range: item.range,
      fixAvailable: item.fixAvailable,
      advisories: (item.via || [])
        .filter(v => typeof v === "object")
        .map(v => ({ title: v.title, range: v.range, url: v.url }))
    }));
  }
}
audit("all-after-safe-fix", ["audit", "--json"]);
audit("production-after-safe-fix", ["audit", "--omit=dev", "--json"]);
await writeFile(
  "public/matmove-customer-vite8-audit.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)
);

const currentPkg = JSON.parse(await readFile("package.json", "utf8"));
console.log("MATMOVE_CUSTOMER_VITE8_VERSIONS " + JSON.stringify({
  vite: currentPkg.devDependencies?.vite,
  pluginReact: currentPkg.devDependencies?.["@vitejs/plugin-react"],
  esbuild: currentPkg.devDependencies?.esbuild,
  node: process.version
}));

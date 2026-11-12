import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const pkgPath = path.join(root, "package.json");

if (!fs.existsSync(pkgPath)) {
  throw new Error(`No existe package.json en ${root}`);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.scripts ||= {};
pkg.scripts["brain:11a:test"] = "node scripts/brain-11a-tests.mjs";
pkg.scripts["brain:verify"] =
  "npm run brain:11a:test && npm run typecheck && npm run build";

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

console.log("✅ package.json actualizado:");
console.log("   brain:11a:test");
console.log("   brain:verify");

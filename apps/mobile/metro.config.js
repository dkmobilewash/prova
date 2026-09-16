// Metro for a pnpm monorepo: the mobile app lives in apps/mobile, but its
// node_modules and any workspace package resolve from the repo root. Tell
// Metro to watch the root and search both node_modules trees so `expo
// start` / `expo export` find every dependency.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;

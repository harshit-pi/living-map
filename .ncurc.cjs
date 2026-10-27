// npm-check-updates settings for `npm run upgrade`, `upgrade:latest` and
// `upgrade:check` (see AGENTS.md).
module.exports = {
  // Skip versions published in the last week: most malicious releases are
  // caught and pulled within days.
  cooldown: 7,
  // Hold back an upgrade another installed package's peer range does not
  // accept yet, so `npm ci` keeps resolving.
  peer: true,
  // Only versions that still run on the Node versions package.json supports.
  enginesNode: true,
  format: ["group"],
  // Doctor mode installs everything, runs these checks, and when they fail
  // retries one package at a time and reverts the ones that break. The
  // install keeps the same week's cooldown for what the new ranges resolve
  // to, direct and transitive.
  doctorInstall: "npm install --min-release-age=7",
  doctorTest: "npm run upgrade:test",
};

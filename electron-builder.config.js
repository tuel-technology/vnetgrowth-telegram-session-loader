/** @type {import('electron-builder').Configuration} */
const pkg = require("./package.json");

if (!process.env.CSC_LINK?.trim()) {
  delete process.env.CSC_LINK;
  delete process.env.CSC_KEY_PASSWORD;
}

const hasMacSign =
  Boolean(process.env.CSC_LINK?.trim()) &&
  Boolean(process.env.CSC_KEY_PASSWORD?.trim());
const hasMacNotarize =
  hasMacSign &&
  Boolean(process.env.APPLE_ID?.trim()) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim()) &&
  Boolean(process.env.APPLE_TEAM_ID?.trim());

module.exports = {
  ...pkg.build,
  mac: {
    ...pkg.build.mac,
    hardenedRuntime: hasMacSign,
    notarize: hasMacNotarize,
  },
};

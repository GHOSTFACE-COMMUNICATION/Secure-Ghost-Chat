const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// One-time Google package-ownership verification (Android API Console OAuth
// client). Google checks for this exact file, at this exact path, inside an
// APK signed with the key whose fingerprint was registered. Safe to leave
// in permanently — it's just a static asset, not a runtime dependency.
const REGISTRATION_SNIPPET = "D7TUAG4XQUN7MAAAAAAAAAAAAA";

module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const assetsDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
      );
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(
        path.join(assetsDir, "adi-registration.properties"),
        REGISTRATION_SNIPPET + "\n",
      );
      return config;
    },
  ]);
};

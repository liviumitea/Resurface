import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh";

function replaceKnownVersion(path, oldText, newText) {
  if (!existsSync(path)) return;
  const original = readFileSync(path, "utf8");
  if (original.includes(newText)) return;
  if (!original.includes(oldText)) {
    throw new Error(`Expo's EXConstants build script changed; inspect ${path} before building.`);
  }
  writeFileSync(path, original.replace(oldText, newText));
  process.stdout.write(`Patched iOS path quoting in ${path}\n`);
}

// Expo SDK 57's podspec invokes a shell script through bash -c without quoting
// the script path. Xcode then truncates checkout paths containing spaces.
const podspec = join(root, "node_modules", "expo-constants", "ios", "EXConstants.podspec");
replaceKnownVersion(
  podspec,
  String.raw`:script => "bash -l -c \"#{env_vars}${scriptPath}\""`,
  String.raw`:script => "#{env_vars}bash -l \"${scriptPath}\""`,
);

// Existing ignored native projects may still contain the script generated from
// the unpatched podspec. A clean prebuild uses the patched podspec above.
const podsProject = join(root, "ios", "Pods", "Pods.xcodeproj", "project.pbxproj");
replaceKnownVersion(
  podsProject,
  `shellScript = ${JSON.stringify(`bash -l -c "${scriptPath}"`)};`,
  `shellScript = ${JSON.stringify(`bash -l "${scriptPath}"`)};`,
);

// Expo's generated main-project bundling phase has a second unquoted command
// substitution. Shell-escape the resolved react-native-xcode.sh path as well.
const appProject = join(root, "ios", "Resurface.xcodeproj", "project.pbxproj");
const resolveScript = `"$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"`;
const escapePbx = (value) => JSON.stringify(value).slice(1, -1);
replaceKnownVersion(
  appProject,
  escapePbx(`\`${resolveScript}\``),
  escapePbx(`"$(${resolveScript})"`),
);

import "react-native-get-random-values";

// Audit finding #5: refuse to boot if crypto.getRandomValues isn't backed by
// a real native CSPRNG. Must run before any other app code — expo-router's
// entry is imported below this, on purpose. See lib/csprng.ts.
import { assertCsprngHealthy } from "./lib/csprng";
assertCsprngHealthy();

import "expo-router/entry";

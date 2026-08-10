export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    if (__DEV__) console.error("[ghostface] EXPO_PUBLIC_DOMAIN is not set — invite API calls will be skipped. Set it in .env or eas.json.");
    return "";
  }
  return `https://${domain}/api`;
}

let assetRoot = null;

export function setAssetRoot(root) {
  assetRoot = root ? new URL(".", root).href : null;
}

/** Resolve content-package asset references from the configured data location. */
export function resolveAssetPath(value) {
  const path = String(value ?? "");
  if (path.startsWith("data/assets/") && assetRoot) return new URL(path.slice("data/".length), assetRoot).href;
  if (path.startsWith("data/assets/")) return path;
  return path;
}

export default resolveAssetPath;

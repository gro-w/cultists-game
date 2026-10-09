// DEV-TOOLS:START
/**
 * devApi - thin fetch wrapper around dev-server.js's /api/ routes
 * (plan §3.2 "开发服务器若实现写盘功能，只绑定 127.0.0.1，并限制到 data/
 * 允许的文件名空间"). Used only by developer-mode editors; never imported
 * by the generic runtime.
 *
 * The dev server is write-only: it has no GET/read routes. Developer-mode
 * tools must read existing game data the same way the game itself does -
 * a normal static fetch() of data/... (e.g. via DataLoader) - not
 * through this module.
 */

/** Overwrites an EXISTING data file only - the dev server never creates new files (plan §6.1 "写入已存在数据文件"). */
export async function writeDataFile(name, jsonText) {
  const response = await fetch(`/api/file?f=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonText,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`POST /api/file?f=${name} failed: ${response.status} ${body}`);
  }
  return response.json();
}

/** Triggers a browser download of `text` as `filename` - used for "下载 JSON". */
export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default { writeDataFile, downloadTextFile };
// DEV-TOOLS:END

(() => {
  const entrypointUrl = document.currentScript?.src || new URL("./core/entrypoint.js", document.baseURI).href;
  const start = async () => {
    let root = null;
    try {
      const locationNode = document.getElementById("data-location");
      const configuredLocation = String(locationNode?.textContent || "").trim();
      if (!configuredLocation) throw new Error("The data-location element must specify a data directory or URL.");
      locationNode.hidden = true;

      const location = configuredLocation.endsWith("/") ? configuredLocation : `${configuredLocation}/`;
      const dataRoot = new URL(location, document.baseURI).href;
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("../style.css", entrypointUrl).href;
      document.head.appendChild(stylesheet);

      const assetStyle = document.createElement("style");
      assetStyle.textContent = `:root { --cultists-font-url: url("${new URL("assets/sarasa-fixed-sc-regular.ttf", dataRoot).href}"); --cultists-location-dorm-image: url("${new URL("assets/location_dorm_ecf66b3d164a.jpg", dataRoot).href}"); }`;
      document.head.appendChild(assetStyle);

      root = document.createElement("div");
      root.id = "ng-root";
      document.body.insertBefore(root, locationNode);
      const { bootstrap } = await import(new URL("./engine-bootstrap.js", entrypointUrl).href);
      await bootstrap(root, { dataRoot });
    } catch (error) {
      console.error("[Cultists Engine] failed to start", error);
      if (root) root.textContent = `Engine failed to start: ${error?.message || error}`;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else void start();
})();

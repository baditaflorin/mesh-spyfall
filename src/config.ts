import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-spyfall",
  description:
    "Secret-role party game — one phone gets 'spy' via commit-reveal, everyone else gets the location",
  accentHex: "#6e44ff",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});

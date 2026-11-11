import vinext from "vinext/server/fetch-handler";
import { handleLanRequest, type LanEnv } from "./lan";
export { LanRoom } from "./lan-room";

export function createWorker(framework = vinext) {
  return {
    async fetch(request: Request, env: LanEnv, context: ExecutionContext) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/lan" || pathname.startsWith("/api/lan/")) {
        if (env.VOIDSHIFT_LAN_ENABLED !== "1") return handleLanRequest(request, env, context);
        if (!env.LAN_ROOM) return Response.json({ error: "lan_runtime_unavailable" }, { status: 503 });
        const room = env.LAN_ROOM.get(env.LAN_ROOM.idFromName("voidshift-local-lobby"));
        return room.fetch(request);
      }
      // Return the original response: copying a 101 loses its native WebSocket.
      return framework.fetch(request, env, context);
    },
  };
}

export default createWorker();

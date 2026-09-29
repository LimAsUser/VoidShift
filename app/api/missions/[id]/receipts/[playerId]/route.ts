import { readReceipt } from "@/db/missions";

export async function GET(request: Request, context: { params: Promise<{ id: string; playerId: string }> }) {
  try {
    const { id, playerId } = await context.params;
    const response = await readReceipt(id, playerId, request.headers.get("x-mission-claim-token") || "");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Mission receipt unavailable", error);
    return Response.json({ error: "mission_service_unavailable" }, { status: 503 });
  }
}

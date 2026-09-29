import { registerMission } from "@/db/missions";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return await registerMission(body, request.headers.get("x-room-host-token") || "");
  } catch (error) {
    console.error("Mission registration unavailable", error);
    return Response.json({ error: "mission_service_unavailable" }, { status: 503 });
  }
}

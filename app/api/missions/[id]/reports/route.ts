import { reportMission } from "@/db/missions";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return await reportMission(id, request.headers.get("x-mission-report-token") || "", body);
  } catch (error) {
    console.error("Mission report unavailable", error);
    return Response.json({ error: "mission_service_unavailable" }, { status: 503 });
  }
}

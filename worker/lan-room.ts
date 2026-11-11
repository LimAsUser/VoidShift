import { DurableObject } from "cloudflare:workers";
import { handleLanRequest, type LanEnv } from "./lan";

// One local actor owns every socket so native WebSocket I/O can cross requests.
export class LanRoom extends DurableObject<LanEnv> {
  constructor(private readonly state: DurableObjectState, private readonly bindings: LanEnv) {
    super(state, bindings);
  }

  fetch(request: Request) {
    return handleLanRequest(request, this.bindings, this.state);
  }
}

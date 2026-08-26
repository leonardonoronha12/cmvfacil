import {NextResponse} from "next/server";
import brazilStates from "../../../admin/observabilidade/brazil-states.geo.json";

export const dynamic="force-static";
export async function GET(){return NextResponse.json(brazilStates,{headers:{"cache-control":"public, max-age=31536000, immutable"}})}

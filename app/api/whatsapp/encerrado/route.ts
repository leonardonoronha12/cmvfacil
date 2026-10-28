import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLOSED_CHANNEL_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Este canal de atendimento foi encerrado.</Message>
</Response>`;

function closedChannelResponse() {
  return new NextResponse(CLOSED_CHANNEL_TWIML, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  return closedChannelResponse();
}

export async function POST() {
  return closedChannelResponse();
}

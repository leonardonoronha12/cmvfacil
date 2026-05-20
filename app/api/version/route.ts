import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      now: new Date().toISOString(),
      vercel: {
        env: process.env.VERCEL_ENV ?? null,
        gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        deploymentUrl: process.env.VERCEL_URL ?? null,
      },
    },
    { status: 200 },
  );
}


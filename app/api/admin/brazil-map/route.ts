import {NextResponse} from "next/server";
export const revalidate=86400;
export async function GET(){try{const response=await fetch("https://servicodados.ibge.gov.br/api/v3/malhas/estados?formato=application/vnd.geo%2Bjson&qualidade=minima",{next:{revalidate:86400}});if(!response.ok)throw new Error(`IBGE ${response.status}`);return NextResponse.json(await response.json(),{headers:{"cache-control":"public, max-age=86400, stale-while-revalidate=604800"}})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:502})}}

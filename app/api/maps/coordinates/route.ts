import { resolveMapCoordinates } from "../../../../lib/mapCoordinates";
import { requireOperator } from "../../../pushAuth";

export async function GET(request: Request) {
  if (!(await requireOperator()))
    return Response.json({ coordinates: null }, { status: 401 });
  const mapUrl = new URL(request.url).searchParams.get("url");
  if (!mapUrl || mapUrl.length > 2_000)
    return Response.json({ coordinates: null }, { status: 400 });

  const coordinates = await resolveMapCoordinates(mapUrl);
  return Response.json(
    { coordinates },
    {
      status: coordinates ? 200 : 400,
      headers: { "cache-control": "public, max-age=86400" },
    },
  );
}

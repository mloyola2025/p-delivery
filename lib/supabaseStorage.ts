const EVIDENCE_BUCKET = "order-evidence";

function storageConfig() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    "";
  if (!baseUrl || !serviceKey)
    throw new Error("Supabase Storage no esta configurado.");
  return { baseUrl: baseUrl.replace(/\/$/, ""), serviceKey };
}

function storageHeaders(serviceKey: string) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

function encodedPath(pathname: string) {
  return pathname.split("/").map(encodeURIComponent).join("/");
}

let bucketReady: Promise<void> | undefined;

async function ensureEvidenceBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const { baseUrl, serviceKey } = storageConfig();
    const headers = storageHeaders(serviceKey);
    const current = await fetch(
      `${baseUrl}/storage/v1/bucket/${EVIDENCE_BUCKET}`,
      { headers, cache: "no-store" },
    );
    if (current.ok) return;
    const created = await fetch(`${baseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        id: EVIDENCE_BUCKET,
        name: EVIDENCE_BUCKET,
        public: false,
        file_size_limit: 10 * 1024 * 1024,
      }),
    });
    if (!created.ok && created.status !== 409)
      throw new Error(`No se pudo preparar Storage (${created.status}).`);
  })().catch((error) => {
    bucketReady = undefined;
    throw error;
  });
  return bucketReady;
}

export function isSupabaseEvidenceUrl(value: string) {
  return value.startsWith(`supabase://${EVIDENCE_BUCKET}/`);
}

export function evidencePathFromUrl(value: string) {
  return isSupabaseEvidenceUrl(value)
    ? value.slice(`supabase://${EVIDENCE_BUCKET}/`.length)
    : value;
}

export async function uploadEvidence(pathname: string, file: File) {
  await ensureEvidenceBucket();
  const { baseUrl, serviceKey } = storageConfig();
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${EVIDENCE_BUCKET}/${encodedPath(pathname)}`,
    {
      method: "POST",
      headers: {
        ...storageHeaders(serviceKey),
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  if (!response.ok)
    throw new Error(`No se pudo subir evidencia (${response.status}).`);
  return `supabase://${EVIDENCE_BUCKET}/${pathname}`;
}

export async function downloadEvidence(pathname: string) {
  const { baseUrl, serviceKey } = storageConfig();
  return fetch(
    `${baseUrl}/storage/v1/object/authenticated/${EVIDENCE_BUCKET}/${encodedPath(pathname)}`,
    { headers: storageHeaders(serviceKey), cache: "no-store" },
  );
}

export async function deleteEvidence(pathnames: string[]) {
  if (!pathnames.length) return;
  const { baseUrl, serviceKey } = storageConfig();
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${EVIDENCE_BUCKET}`,
    {
      method: "DELETE",
      headers: {
        ...storageHeaders(serviceKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefixes: pathnames }),
    },
  );
  if (!response.ok)
    throw new Error(`No se pudo eliminar evidencia (${response.status}).`);
}

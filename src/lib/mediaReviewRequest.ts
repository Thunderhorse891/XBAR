export async function persistMediaReview(input: {
  apiBase: string;
  accessToken: string;
  workspaceId: string;
  horseId: string;
  assetId: string;
  approved: boolean;
  expectedStoragePath: string;
  expectedUrl: string;
}) {
  const { apiBase, accessToken, ...body } = input;
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/account/media-review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true)
      return { ok: false, message: result.message || 'Shared review could not be saved.' };
    if (
      result.workspaceId !== body.workspaceId ||
      result.horseId !== body.horseId ||
      result.assetId !== body.assetId ||
      result.status !== (body.approved ? 'Approved' : 'Pending')
    )
      return { ok: false, message: 'Shared review was not acknowledged. Reload before trying again.' };
    return { ok: true, message: 'Media review saved to the shared ranch.' };
  } catch {
    return { ok: false, message: 'Shared review could not be confirmed. Reload before trying again.' };
  }
}

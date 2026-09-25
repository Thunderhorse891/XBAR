export function checkBackupEvidence(evidence, sourceRef, now = Date.now()) {
  const failures = [];
  const fresh = (value, age) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && time <= now && now - time <= age;
  };
  if (!sourceRef || evidence?.sourceRef !== sourceRef) failures.push('production project does not match');
  if (!fresh(evidence?.createdAt, 36 * 3600_000)) failures.push('backup missing, future-dated or older than 36 hours');
  if (!/^[a-f0-9]{64}$/.test(evidence?.archiveSha256 ?? '')) failures.push('archive checksum missing');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(evidence?.runUrl ?? ''))
    failures.push('backup run evidence missing');
  const restore = evidence?.restore;
  if (!restore?.target || restore.target === sourceRef) failures.push('distinct scratch restore target missing');
  if (!fresh(restore?.verifiedAt, 7 * 86400_000)) failures.push('restore verification missing or stale');
  if (restore?.archiveSha256 !== evidence?.archiveSha256) failures.push('restore does not match this archive');
  if (restore?.schemaAndDataVerified !== true || restore?.rlsVerified !== true)
    failures.push('restore validation incomplete');
  return { ok: failures.length === 0, failures };
}

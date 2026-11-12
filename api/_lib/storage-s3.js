// Server-only S3 credentials. Never use a Supabase JWT as an AWS session token.
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const UPLOAD_URL_TTL_SECONDS = 300;
const isMissing = (error) => ['NoSuchKey', 'NotFound', 'NoSuchUpload'].includes(error?.name);

export function createStorageTransport(env = process.env) {
  const project = new URL(env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://unconfigured.invalid');
  const endpoint = new URL(env.SUPABASE_STORAGE_S3_ENDPOINT || `${project.origin}/storage/v1/s3`);
  const origins = new Set([project.origin]);
  if (/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname))
    origins.add(`https://${project.hostname.replace('.supabase.co', '.storage.supabase.co')}`);
  const accessKeyId = env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY;
  if (
    !accessKeyId ||
    !secretAccessKey ||
    !env.SUPABASE_STORAGE_S3_REGION ||
    !origins.has(endpoint.origin) ||
    endpoint.protocol !== 'https:' ||
    endpoint.pathname.replace(/\/$/, '') !== '/storage/v1/s3' ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password ||
    accessKeyId.includes('.') ||
    secretAccessKey.split('.').length === 3
  )
    throw new Error('Controlled storage uploads are not configured.');
  const client = new S3Client({
    endpoint: endpoint.href,
    region: env.SUPABASE_STORAGE_S3_REGION,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // An uncertain write must be reconciled, not silently retried by middleware.
    maxAttempts: 1,
  });
  return storageTransportForClient(client);
}

// Exported for real-provider contract tests with a synthetic local S3 client.
export function storageTransportForClient(client) {
  const target = (row) => ({ Bucket: row.bucket_id, Key: row.object_path, UploadId: row.provider_upload_id });
  return {
    async create(row) {
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: row.bucket_id,
          Key: row.object_path,
          ContentType: row.content_type,
        }),
      );
      if (!result.UploadId) throw new Error('Missing multipart acknowledgment.');
      return result.UploadId;
    },
    async signPart(row, partNumber, sizeBytes) {
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          ...target(row),
          PartNumber: partNumber,
          ContentLength: sizeBytes,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length']) },
      );
      const query = new URL(url).searchParams;
      if (!query.get('X-Amz-SignedHeaders')?.split(';').includes('content-length') || query.has('X-Amz-Security-Token'))
        throw new Error('Unsafe multipart signature.');
      return url;
    },
    async putPart(row, partNumber, bytes) {
      await client.send(
        new UploadPartCommand({ ...target(row), PartNumber: partNumber, ContentLength: bytes.byteLength, Body: bytes }),
      );
    },
    async listParts(row) {
      const parts = [];
      let marker;
      do {
        const page = await client.send(new ListPartsCommand({ ...target(row), PartNumberMarker: marker }));
        if (!Array.isArray(page.Parts) && page.Parts !== undefined) throw new Error('Invalid multipart inventory.');
        parts.push(...(page.Parts || []));
        if (!page.IsTruncated) break;
        if (!page.NextPartNumberMarker || page.NextPartNumberMarker === marker || parts.length > 10000)
          throw new Error('Incomplete multipart inventory.');
        marker = page.NextPartNumberMarker;
      } while (marker);
      return parts;
    },
    async findCreated(row) {
      const found = [];
      let keyMarker, uploadIdMarker;
      do {
        const page = await client.send(
          new ListMultipartUploadsCommand({
            Bucket: row.bucket_id,
            Prefix: row.object_path,
            KeyMarker: keyMarker,
            UploadIdMarker: uploadIdMarker,
          }),
        );
        found.push(...(page.Uploads || []).filter((entry) => entry.Key === row.object_path));
        if (!page.IsTruncated) break;
        if (!page.NextKeyMarker || (keyMarker === page.NextKeyMarker && uploadIdMarker === page.NextUploadIdMarker))
          throw new Error('Incomplete upload inventory.');
        keyMarker = page.NextKeyMarker;
        uploadIdMarker = page.NextUploadIdMarker;
      } while (keyMarker);
      return found.length === 1 ? found[0].UploadId : null;
    },
    async complete(row, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          ...target(row),
          MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
        }),
      );
    },
    async head(row) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: row.bucket_id, Key: row.object_path }));
        if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength < 0)
          throw new Error('Unknown object size.');
        return { sizeBytes: result.ContentLength };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async abort(row) {
      try {
        await client.send(new AbortMultipartUploadCommand(target(row)));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      // A response alone cannot establish the multipart upload is gone.
      try {
        await client.send(new ListPartsCommand(target(row)));
        return false;
      } catch (error) {
        if (error?.name === 'NoSuchUpload') return true;
        throw error;
      }
    },
  };
}

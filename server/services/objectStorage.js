import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

let cachedClient = null;
let cachedS3Sdk = null;

const require = createRequire(import.meta.url);

const getS3Sdk = () => {
  if (cachedS3Sdk) return cachedS3Sdk;
  try {
    cachedS3Sdk = require('@aws-sdk/client-s3');
    return cachedS3Sdk;
  } catch (e) {
    const err = new Error('S3 storage requires @aws-sdk/client-s3, but it is not available in this build');
    err.cause = e;
    throw err;
  }
};

export const getUploadStorageMode = () => String(process.env.UPLOAD_STORAGE || 'local').toLowerCase();

export const isS3UploadStorage = () => getUploadStorageMode() === 's3';

export const getS3PublicBaseUrl = () => {
  const raw = String(process.env.S3_PUBLIC_BASE_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : '';
};

export const getS3Client = () => {
  if (cachedClient) return cachedClient;

  const region = String(process.env.S3_REGION || 'auto');
  const endpoint = String(process.env.S3_ENDPOINT || '').trim();
  const accessKeyId = String(process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.S3_SECRET_ACCESS_KEY || '').trim();

  const { S3Client } = getS3Sdk();
  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: endpoint ? true : undefined,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });

  cachedClient = client;
  return client;
};

export const getS3Bucket = () => String(process.env.S3_BUCKET || '').trim();

export const ensureS3Configured = () => {
  const bucket = getS3Bucket();
  if (!bucket) {
    throw new Error('S3_BUCKET is required when UPLOAD_STORAGE=s3');
  }
  return bucket;
};

export const s3KeyFromUploadsPath = (uploadsPath) => {
  const base = path.basename(String(uploadsPath || ''));
  if (!base) throw new Error('Invalid upload key');
  return base;
};

export const s3ObjectExists = async (key) => {
  const bucket = ensureS3Configured();
  const client = getS3Client();
  try {
    const { HeadObjectCommand } = getS3Sdk();
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
};

export const s3PutFile = async ({ key, filePath, contentType }) => {
  const bucket = ensureS3Configured();
  const client = getS3Client();
  const body = fs.createReadStream(filePath);
  const acl = String(process.env.S3_OBJECT_ACL || '').trim();

  const { PutObjectCommand } = getS3Sdk();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || undefined,
      ACL: acl || undefined,
    }),
  );
};

export const s3CopyObject = async ({ sourceKey, destKey, contentType }) => {
  const bucket = ensureS3Configured();
  const client = getS3Client();
  const acl = String(process.env.S3_OBJECT_ACL || '').trim();

  const { CopyObjectCommand } = getS3Sdk();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
      ContentType: contentType || undefined,
      MetadataDirective: contentType ? 'REPLACE' : undefined,
      ACL: acl || undefined,
    }),
  );
};

export const s3DeleteObject = async (key) => {
  const bucket = ensureS3Configured();
  const client = getS3Client();
  const { DeleteObjectCommand } = getS3Sdk();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

export const getPublicUrlForKey = (key) => {
  const base = getS3PublicBaseUrl();
  if (!base) return '';
  return `${base}/${encodeURIComponent(String(key || ''))}`;
};

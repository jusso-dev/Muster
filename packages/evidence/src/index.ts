import { z } from "zod";

export * from "./object-storage.ts";

export const evidenceMimeAllowlist = [
  "application/json",
  "application/pdf",
  "application/zip",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
] as const;

export const EvidenceUploadRequestSchema = z.object({
  organisationId: z.string().uuid(),
  fileName: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !/[\/\\\0]/.test(value), "Unsafe file name"),
  mimeType: z.enum(evidenceMimeAllowlist),
  size: z
    .number()
    .int()
    .positive()
    .max(250 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  classification: z.enum(["public", "internal", "confidential", "restricted"]),
});

export interface ObjectStorageAdapter {
  presignUpload(
    storageKey: string,
    mimeType: string,
    size: number,
    expiresSeconds: number,
  ): Promise<string>;
  presignDownload(storageKey: string, expiresSeconds: number): Promise<string>;
  quarantine(storageKey: string): Promise<void>;
}

export function evidenceStorageKey(
  organisationId: string,
  evidenceId: string,
  fileName: string,
) {
  const safeName = fileName.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `organisations/${organisationId}/evidence/${evidenceId}/${safeName}`;
}

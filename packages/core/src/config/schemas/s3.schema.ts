import { z } from "zod";

export const S3ConfigSchema = z.object({
	s3Endpoint: z.string().url(),
	s3AccessKeyId: z.string().min(1),
	s3SecretAccessKey: z.string().min(1),
	s3Bucket: z.string().min(1).default("wallpapers"),
	s3Region: z.string().default("us-east-1"),
});

export type S3Config = z.infer<typeof S3ConfigSchema>;

export type Quality = '1k' | '2k' | '4k';

export interface ImporterConfig {
  schemaVersion: 1;
  apiBaseUrl: string;
  userAgent: string;
  operatorContact: string;
  workDirectory: string;
  publicDirectory: string;
  sourceCeiling: Quality;
  runtimeTiers: Quality[];
  metadataConcurrency: number;
  downloadConcurrency: number;
  requestPacingMs: number;
  maxRetries: number;
  allowedDownloadHosts: string[];
  environmentRoots: Record<'pure-skies' | 'mountains-hills' | 'forest-woodland', string>;
  publish: { destination: string; catalogOrigin: string };
  tools: { toktx: string; toktxPath?: string; oiiotool: string; oiiotoolPath?: string };
  deployment?: {
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    storageBucket: string;
    allowedOrigins: string[];
  };
}

export interface ApiFileLeaf { url: string; size?: number; md5?: string; [key: string]: unknown }
export interface SourceMapChoice {
  sourceKey: string;
  semantic?: string;
  status: 'selected' | 'alternative' | 'container' | 'unresolved-map';
  resolution?: string;
  format?: string;
  leaf?: ApiFileLeaf;
  reason: string;
}

export interface ReleaseSnapshot {
  schemaVersion: 1;
  release: string;
  acquiredAt: string;
  openApiSha256: string;
  taxonomy: { textures: unknown; hdris: unknown };
  assets: { textures: Record<string, unknown>; hdris: Record<string, unknown> };
  records: Record<string, { info: unknown; files: unknown; kind: 'material' | 'hdri'; environmentGroup?: string }>;
}

export interface IngestPlan {
  schemaVersion: 1;
  release: string;
  generatedAt: string;
  sourceCeiling: Quality;
  assets: Array<{ id: string; kind: 'material' | 'hdri'; choices: SourceMapChoice[]; estimatedBytes: number }>;
  totals: { assets: number; files: number; estimatedBytes: number; blocking: number };
}

export type KeAction =
  | 'image-description'
  | 'text-classification'
  | 'named-entity-recognition-image'
  | 'named-entity-recognition-text'
  | 'text-summarization';

export type KeDocumentClasses = string[];
export type KeNamedEntityMap = Record<string, string[]>;

export interface KeActionConfig {
  classes?: string[];
  maxWordCount?: number;
  instructions?: Record<string, unknown>;
  kSimilarMetadata?: Array<Record<string, unknown>>;
}

export interface KeEnrichRequest {
  actions: KeAction[];
  sourceId?: string;
  configName?: string;
  classes?: KeDocumentClasses;
  maxWordCount?: number;
  instructions?: Record<string, unknown>;
  v2Actions?: Record<string, KeActionConfig>;
}

export interface KeProcessingError {
  errorType?: string | null;
  message?: string | null;
}

export interface KeStringResult {
  isSuccess: boolean;
  result: string | null;
  error?: KeProcessingError | null;
}

export interface KeStringListDictionaryResult {
  isSuccess: boolean;
  result: KeNamedEntityMap | null;
  error?: KeProcessingError | null;
}

export interface KeStringDictionaryResult {
  isSuccess: boolean;
  result: Record<string, unknown> | null;
  error?: KeProcessingError | null;
}

export interface KeEnrichmentResult {
  requestId?: string | null;
  status?: string | null;
  inProgress: boolean;
  objectKey?: string | null;
  imageDescription?: KeStringResult | null;
  textSummary?: KeStringResult | null;
  textClassification?: KeStringResult | null;
  namedEntityText?: KeStringListDictionaryResult | null;
  namedEntityImage?: KeStringListDictionaryResult | null;
  imageMetadata?: KeStringDictionaryResult | null;
  textMetadata?: KeStringDictionaryResult | null;
  generalProcessingErrors: KeProcessingError[];
  raw: unknown;
}

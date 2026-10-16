export type KeAction =
  | 'image-description'
  | 'text-classification'
  | 'named-entity-recognition-image'
  | 'named-entity-recognition-text'
  | 'text-summarization';

/**
 * Action names the Context API expects on the wire, keyed by our `KeAction`.
 *
 * The connector speaks the v2 Context API, where action names are camelCase.
 * The kebab-case names are v1 and are rejected with
 * `Unknown action 'text-summarization'. Actions array must contain only known
 * actions.` — an HTTP 400 that reaches the user as a bare "Bad Request", with
 * nothing pointing at the action name as the cause.
 *
 * The kebab-case form stays as our internal vocabulary: it is what templates,
 * component state and tests are written against. Translating once, where the
 * request is serialised, keeps that intact and leaves a single place to change
 * if the wire contract moves again.
 */
export const KE_ACTION_WIRE_NAMES: Record<KeAction, string> = {
  'image-description': 'imageDescription',
  'text-classification': 'textClassification',
  'named-entity-recognition-image': 'namedEntityRecognitionImage',
  'named-entity-recognition-text': 'namedEntityRecognitionText',
  'text-summarization': 'textSummarization',
};

/** Translate one internal action name to the name the Context API expects. */
export function toKeWireAction(action: KeAction): string {
  return KE_ACTION_WIRE_NAMES[action] ?? action;
}

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

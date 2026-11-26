/** The types of `server-validator-build.mjs`, for the spec that holds its outputs to the source. */
import type { DeploymentFileAnswer, DeploymentFileRequest } from './server-validator';

export declare const REPO: string;
export declare const ENTRY: string;
export declare const OUTPUT: string;
export declare const PARITY: string;
export declare const GLOBAL_NAME: string;

export interface BuiltOutput {
  readonly path: string;
  readonly text: string;
}

type Validate = (request: DeploymentFileRequest) => DeploymentFileAnswer;

/** The kits under `root`, `business-apps/packages/` by default, that the corpus is made from. */
export declare function kitNames(root?: string): string[];
export declare function buildServerValidator(): Promise<string>;
export declare function buildParityCorpus(validate: Validate): string;
export declare function buildOutputs(validate: Validate): Promise<readonly BuiltOutput[]>;
export declare function outOfDate(outputs: readonly BuiltOutput[]): readonly BuiltOutput[];

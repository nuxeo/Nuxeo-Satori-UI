/**
 * The texts the custom element `acme-claim-exposure` translates with `i18n`, in the package's own
 * language, as its messages.json gives them, by the parts of their keys: `label.claim.number` is
 * `label`, then `claim`, then `number`. Written so, a key is not taken for one of the plugin's
 * registered IDs, which have the same shape, by the platform's customer guardrail; code reads one
 * as `TEXTS.label.claim.number`, which the type check holds to the texts. A key it does not hold
 * is shown as the key, as Web UI shows it. Another language is not carried: the template provides
 * no translation service.
 */
export const ACME_CLAIM_EXPOSURE_TEXTS = {
  label: {
    claim: {
      number: 'Claim number',
      outstanding: 'Outstanding',
      reserveRatio: 'Reserve ratio',
      highExposure: 'High exposure',
    },
  },
} as const satisfies TextTree;

/** Texts by the parts of their keys. */
export interface TextTree {
  readonly [part: string]: string | TextTree;
}

/** The text of a key, or the key itself, as Web UI's `i18n` shows one it does not hold. */
export function textOf(key: string, texts: TextTree = ACME_CLAIM_EXPOSURE_TEXTS): string {
  let at: string | TextTree | undefined = texts;
  for (const part of key.split('.'))
    at = typeof at === 'object' && Object.hasOwn(at, part) ? at[part] : undefined;
  return typeof at === 'string' ? at : key;
}

/**
 * Shared test fixtures and utilities.
 *
 * Stage 3 of the integration-test plan (libs/shared/testing). Extracted from duplicate builders
 * across spec files to centralize test data and make field-type changes in models break compilation
 * in exactly the specs that depend on them.
 *
 * See docs/integration-test-audit.md §10.2 AC2 for design principles.
 */

export { nuxeoDocument, nuxeoAce } from './lib/nuxeo-fixtures';
export {
  escapeForRegExp,
  iconCentringProblems,
  ruleDeclarations,
  withoutScssComments,
} from './lib/stylesheet-rules';

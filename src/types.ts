// Shared types used across Schemify transformers.

/** The output of a transformer: a display label and the generated code. */
export interface TransformResult {
  label: string;
  code: string;
}

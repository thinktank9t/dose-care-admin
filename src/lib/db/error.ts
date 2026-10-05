import "server-only";

/**
 * Postgres error codes and the one way this app renders a database error.
 *
 * The dashboard shows an operator the database's own words when a write
 * fails. That is a deliberate choice, argued once here rather than at each
 * call site: every page is already behind `requireAdmin()`, and the person
 * reading the message is the person who can act on "value too long for type
 * character varying(16)". Collapsing that into "something went wrong" moves
 * the diagnosis somewhere they cannot reach.
 *
 * Codes are named because `"23505"` at a call site says nothing. These four
 * are the ones a hand-typed row can actually provoke.
 */
export const PG = {
  /** A row with this primary key already exists. */
  UNIQUE_VIOLATION: "23505",
  /** A NOT NULL column was sent null. */
  NOT_NULL_VIOLATION: "23502",
  /** A CHECK or domain constraint said no. The schema's own rule, not ours. */
  CHECK_VIOLATION: "23514",
  /** The text could not be coerced to the column type — a malformed interval. */
  INVALID_TEXT_REPRESENTATION: "22P02",
} as const;

/**
 * Codes meaning "the database rejected this input", as opposed to "the write
 * broke". The difference matters to the operator: the first is a value to
 * correct, the second is a problem to report.
 */
export const REJECTION_CODES: readonly string[] = [
  PG.NOT_NULL_VIOLATION,
  PG.CHECK_VIOLATION,
  PG.INVALID_TEXT_REPRESENTATION,
];

export type DbError = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

/** PostgREST returns the code separately from the prose; both matter. */
export function describe(error: DbError): string {
  return [error.code ? `[${error.code}]` : null, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" — ");
}

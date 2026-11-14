/**
 * A refusal of an online operation (DESIGN.md §11.6): `not_found` for anything not the account's (answered as a 404 with no body, as a group that is
 * not there), or a rule that holds, said in a sentence (a 409 or a 400).
 */
export class OpError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'invalid'
      | 'id_taken'
      | 'last_owner'
      | 'too_many_groups'
      | 'unsettled'
      | 'not_empty',
    readonly sentence?: string,
  ) {
    super(sentence ?? code);
    this.name = 'OpError';
  }
}

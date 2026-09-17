# Contributor licensing and provenance

BetterDesk is distributed under AGPL-3.0 as described in
[`LICENSE`](../../LICENSE). This document records the maintainer policy for
contributions; it is not legal advice.

## Copyright and project control

The copyright notice in `LICENSE` identifies the project copyright holder, but
it does not automatically transfer copyright in every later contribution to
UNITRONIX. A contributor normally retains copyright in original code they
write unless a separate written agreement says otherwise.

`Co-authored-by` records authorship. It is not a copyright assignment, a
license grant beyond the project license, or a promise of exclusive ownership.
Do not invent an email address for this trailer.

When UNITRONIX does not have an assignment, preserve the contributor's
copyright and AGPL treatment instead of claiming exclusive ownership. Record
the source and the actual use in
[Contributor attributions](CONTRIBUTOR-ATTRIBUTIONS.md).

When UNITRONIX specifically needs exclusive control of a contribution, obtain
a written copyright assignment or an appropriate contributor agreement before
accepting code. Keep that agreement outside the public repository and record
its reference in the maintainer's contribution register.

## Direct contribution and clean-room paths

There are two fair and reviewable paths:

- **Direct contribution:** preserve the contributor's copyright, provenance,
  AGPL license, and attribution. A pull request is not a copyright assignment.
- **Clean-room implementation:** use only the reviewed specification,
  observable behavior, and independently written test vectors; credit the
  source for the report or design, not as an author of code they did not
  write.

When an external patch is not accepted directly:

1. The specification role records the problem, public behavior, security
   invariants, and independently written test vectors.
2. The implementation role receives that specification, not the external
   patch, source-derived comments, copied tests, or generated artifacts.
3. The implementation is written independently against the BetterDesk
   architecture and reviewed for provenance before merge.
4. The external reporter is credited for the report, design input, or test
   scenario only when that is what they supplied.

Bug reports, requirements, protocol observations, and test ideas do not by
themselves transfer copyright in implementation code. Do not copy an external
PR's code, comments, tests, generated output, or distinctive structure into a
clean-room implementation.

## AGPL obligations

This policy does not add proprietary restrictions to AGPL-covered code.
Conveyed BetterDesk modifications must preserve the applicable AGPL notices,
source availability, and remote-network source offer requirements. A
commercial grant or dual license may be offered only for material whose
copyright and third-party permissions UNITRONIX actually controls.

Before merging an externally derived implementation, maintainers must record:

- the source issue/PR and what was actually used;
- whether code was directly accepted, rewritten clean-room, or supplied under
  a written assignment/agreement;
- applicable copyright and license notices;
- the intended attribution in `CHANGELOG.md` or release notes.

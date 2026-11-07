# OCR dates and parent registrations require source evidence

MAIN-20 reproduced on main `433cd6ceb7ed16495c288c639bbe964dc0c0b288`:
a Coggins filename supplied the examination date ahead of the printed test date;
an unrelated issue date became the horse's birthdate; impossible dates survived
normalization; a leap-day anniversary became an impossible February 29.
MAIN-21 also reproduced: an unqualified registration field after the dam was
silently assigned to the dam, including after OCR flattened the line break.

Browser and server OCR now share a pure printed-date parser. A date must follow
the appropriate label and name a real calendar day. Conflicting labeled dates
remain unknown. Filenames, issue dates, missing components, and parent-section
birthdates cannot supply the subject's birthdate or examination date. Numeric
dates retain the existing US month/day convention and two-digit-year convention.
February 29 anniversaries use February 28 in a non-leap year.

On a subject's paper, a generic full registration field after a parent's name
or a separate `Reg No` row no longer establishes that parent's first identifier.
The unknown number is not reassigned to the subject either. Explicit qualified
parent fields, established inline parent-ID forms, and parent-only fragments
retain their supported identities. Conflicting repeated identifiers still need
review; the new scope check does not suppress that conflict detection.

Tests cover the reproduced failures, valid leap dates and supported written
formats, conflicting evidence, parent/subject boundaries, and actual local-store
intake → extraction → review → serialized reload. The store workflow uses a
synthetic text document; it does not prove recognition of a customer's scan,
external OCR availability, original-file vault durability, or hosted cloud sync.

No historical customer fields are rewritten. Existing questionable dates or
pedigree identifiers still need source-document review. This change does not
resolve separate automatic identity-matching behavior, and changes no database,
Stripe configuration, or billing terms.

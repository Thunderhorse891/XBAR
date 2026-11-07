# Hold conflicting OCR identity for review

The retained bulk OCR API could attach a high-confidence document to a same-name
horse even when both registration number and microchip disagreed, then report a
matched document without review. A registration match also bypassed the microchip
lookup, and an ambiguous source candidate could still attach to an existing horse.
These were reproduced against the actual handler with synthetic database IO;
no customer or production record was used.

Automatic matching now checks both strong identifiers, refuses conflicting names
or identifiers and duplicate matches, and holds ambiguous candidates unassigned.
Documents sharing an identifier but naming different horses are held together.
The document and processing-job review holds must both be acknowledged before
reporting batch success. Originals and existing horse fields remain untouched;
hold failures retain the existing partial-recovery response.

Matching consistent identity and a unique name with missing stored identifiers
retain their supported behavior. Explicit manual assignment remains a separate
authorized review action. There is no historical record rewrite or database
migration. The current browser uses its own store intake; this repair secures the
retained server route and does not claim hosted customer workflow acceptance.

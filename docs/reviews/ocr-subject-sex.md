# Parent facts are not the subject's sex

Actual local built-app OCR of a synthetic registration PNG returned `sex: Mare`
solely because its dam was named PRETTY MARE. No subject sex was printed. A
separate server regression reproduced a parent-section `Sex: Mare` being read
as the subject's gender.

Both registration extractors now read sex/gender only from the already-established
subject section before pedigree fields. Explicit subject sex and supported
unlabeled subject descriptions such as "this bay mare" are preserved. Parent
names and parent sex fields remain available in the original source but cannot
supply the subject field.

The browser and server regressions failed before the correction. This is a
bounded extraction change; it does not rewrite historical horses, change profile
defaults or the HorseSex type, or claim every unlabeled fact is now unambiguous.
No database migration or Stripe change is involved.

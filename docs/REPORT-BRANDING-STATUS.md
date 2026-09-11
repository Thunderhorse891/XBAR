# Report branding and legal status

The horse header and X footer use the PNG artwork supplied by Erin on September 11, 2026, without changing the originals. `public/brand/xbar-report-watermark.png` is an AI-assisted print derivative on white, not a replacement master logo or trademark filing drawing. It is embedded faintly behind report content. Reports retain the customer's ranch identity and describe figures as based on workspace records.

PDF exports display **XBAR™**, not a registered-mark symbol. They do not claim certification, legal review, independent audit, or company registration. CSV exports remain plain data and cannot carry an image watermark.

Images are packaged with the application and loaded from the same origin; no report records are uploaded to generate the PDF. A first export needs those static assets available. Missing branding fails visibly rather than silently producing an unbranded report. The existing service worker caches successful brand asset requests for subsequent offline use; offline-first-use availability has not been established.

## Still requires evidence

- Exact legal entity name, formation jurisdiction, and registration record.
- Rights/permission chain for supplied artwork and any commissioned work.
- Trademark clearance for the intended goods/services and target countries.
- Any registration number, jurisdiction, covered goods/services, and current status before displaying a registered-mark symbol.
- Operator identity and jurisdiction-specific review of terms, privacy notices, billing disclosures, and international launch obligations.

No entity formation, trademark clearance, trademark application, fee payment, or legal certification was completed by adding this branding. Do not describe these as complete merely because CI passes.

## Official references checked September 11, 2026

- [USPTO: What is a trademark?](https://www.uspto.gov/trademarks/basics/what-trademark): TM/SM can identify an unregistered mark; the registered symbol is reserved for registered marks in their covered goods/services.
- [SBA: Launch your business](https://www.sba.gov/counseling/launch-your-business/): entity, DBA, domain, and trademark registrations serve different purposes.
- [WIPO: Madrid System](https://www.wipo.int/en/web/madrid-system): international protection involves selected territories and their requirements, not automatic worldwide rights.

This records implementation and unresolved verification, not a legal opinion that XBAR is cleared or compliant worldwide.

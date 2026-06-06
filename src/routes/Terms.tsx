export default function Terms() {
  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: 'clamp(32px,6vw,80px) clamp(16px,4vw,40px)', color: '#e8f2ff', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '8px' }}>Terms of Service</h1>
      <p style={{ color: 'rgba(140,175,210,0.6)', marginBottom: '36px', fontSize: '13px' }}>Last updated: {new Date().getFullYear()}</p>
      {[
        ['1. Acceptance', 'By accessing or using XBAR LLC™ ("XBAR", "we", "us"), you agree to be bound by these Terms of Service. If you do not agree, do not use the service.'],
        ['2. Service Description', 'XBAR is a horse records and ranch operations platform. It provides tools for tracking horse health, ownership, documents, sale packets, and operational data. XBAR does not provide legal, financial, or veterinary advice.'],
        ['3. Subscriptions', 'XBAR offers paid subscription plans billed monthly. You may cancel at any time. Refunds are not provided for partial billing periods. We reserve the right to change pricing with 30 days notice.'],
        ['4. Your Data', 'You retain ownership of all data you enter into XBAR. We do not sell your data to third parties. You are responsible for the accuracy of information you upload, including horse registration data, ownership records, and health documents.'],
        ['5. Buyer Profile Disclaimer', 'Sale packet pages shared via XBAR contain information provided by the seller. XBAR LLC™ does not verify, warrant, or guarantee the accuracy of any horse records, registration numbers, health data, or ownership claims. Buyers are solely responsible for independent verification before any purchase.'],
        ['6. Acceptable Use', 'You may not use XBAR to upload false registration records, misrepresent horse health or ownership, or facilitate fraudulent horse sales. Violation may result in immediate account termination.'],
        ['7. Limitation of Liability', 'XBAR LLC™ is not liable for any horse sale disputes, registration errors, health record inaccuracies, or financial losses arising from use of the platform. Maximum liability is limited to the amount you paid in the prior 3 months.'],
        ['8. Governing Law', 'These terms are governed by the laws of the State of Texas, United States.'],
        ['9. Contact', 'Questions about these terms: legal@xbar.app'],
      ].map(([title, body]) => (
        <section key={title as string} style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '8px', color: '#c8dff0' }}>{title as string}</h2>
          <p style={{ color: 'rgba(175,205,235,0.72)', lineHeight: 1.7, fontSize: '14px' }}>{body as string}</p>
        </section>
      ))}
    </main>
  );
}

export default function Privacy() {
  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: 'clamp(32px,6vw,80px) clamp(16px,4vw,40px)', color: '#e8f2ff', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '8px' }}>Privacy Policy</h1>
      <p style={{ color: 'rgba(140,175,210,0.6)', marginBottom: '36px', fontSize: '13px' }}>Last updated: {new Date().getFullYear()}</p>
      {[
        ['Information We Collect', 'We collect information you provide directly: account email, workspace profile, horse records, documents, health data, expense receipts, and sale information. We also collect usage data to improve the product.'],
        ['How We Use Your Information', 'We use your data to provide the XBAR service, sync your workspace across devices, send invite and transactional emails, and process subscription payments through Stripe. We do not use your horse or ranch data for advertising.'],
        ['Data Storage', 'Your workspace data is stored in Supabase (PostgreSQL) and Supabase Storage. Documents and media are stored in encrypted cloud storage. Local backups are stored in your browser\'s IndexedDB.'],
        ['Third-Party Services', 'XBAR uses Supabase (auth and database), Stripe (payments), and Open-Meteo (weather). We do not sell your data to any third party. Each service has its own privacy policy.'],
        ['Public Sale Packets', 'When you create a sale listing and share the link, the buyer-facing profile is publicly accessible to anyone with the link. Only fields you explicitly approve are shown to buyers. Internal data (medical notes, ownership details, financial records) is never exposed.'],
        ['Data Retention', 'Your data is retained for the life of your account. You may export your workspace at any time from Settings. Account deletion removes all associated data within 30 days.'],
        ['Your Rights', 'You may access, export, or delete your data at any time from Settings → Workspace backup. For deletion requests: privacy@xbar.app'],
        ['Contact', 'Privacy questions: privacy@xbar.app'],
      ].map(([title, body]) => (
        <section key={title as string} style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '8px', color: '#c8dff0' }}>{title as string}</h2>
          <p style={{ color: 'rgba(175,205,235,0.72)', lineHeight: 1.7, fontSize: '14px' }}>{body as string}</p>
        </section>
      ))}
    </main>
  );
}

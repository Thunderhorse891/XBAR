import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="legal-page">
      <header className="legal-page__header">
        <Link to="/" className="legal-page__back">← XBAR</Link>
      </header>
      <main className="legal-page__body">
        <h1>Privacy Policy</h1>
        <p className="legal-page__effective">Effective date: June 1, 2025</p>

        <h2>1. Who We Are</h2>
        <p>
          XBAR LLC ("XBAR", "we", "us") operates the XBAR Ranch Platform. This Privacy Policy explains
          how we collect, use, and protect information when you use our Service.
        </p>

        <h2>2. Information We Collect</h2>
        <h3>Information you provide</h3>
        <ul>
          <li>Account registration: name, email address, organization name</li>
          <li>Horse records: names, registration numbers, medical history, ownership data, documents</li>
          <li>Billing information: processed by Stripe — XBAR never stores full card numbers</li>
          <li>Communications: support requests, feedback</li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li>Usage data: pages visited, features used, timestamps</li>
          <li>Device data: browser type, operating system, IP address</li>
          <li>Cookies and local storage: session tokens, workspace preferences</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide and improve the Service</li>
          <li>Process billing and manage subscriptions</li>
          <li>Send transactional emails (invites, receipts, alerts)</li>
          <li>Respond to support requests</li>
          <li>Detect and prevent fraud or abuse</li>
          <li>Comply with legal obligations</li>
        </ul>
        <p>We do not sell your personal data to third parties.</p>

        <h2>4. Buyer Profile Sharing</h2>
        <p>
          When you generate a shareable buyer profile link, the information you select becomes accessible
          to anyone with that link. XBAR displays only the fields you choose to include. Sensitive fields
          (insured value, medical notes, private ownership stakes) are never included in shared profiles
          regardless of your settings.
        </p>

        <h2>5. Data Sharing</h2>
        <p>We share data only with:</p>
        <ul>
          <li><strong>Supabase</strong> — database and authentication infrastructure</li>
          <li><strong>Stripe</strong> — payment processing</li>
          <li><strong>Vercel</strong> — hosting and edge functions</li>
          <li>Legal authorities when required by law</li>
        </ul>

        <h2>6. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active. If you cancel your account, we will
          delete your data within 90 days, except where retention is required by law.
        </p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard security measures including encryption in transit (TLS), encrypted
          storage, and role-based access controls. No system is perfectly secure; we cannot guarantee
          absolute security.
        </p>

        <h2>8. Your Rights</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Object to or restrict processing</li>
          <li>Data portability (export your workspace backup from Settings)</li>
        </ul>
        <p>
          To exercise these rights, contact us at <a href="mailto:privacy@xbar.app">privacy@xbar.app</a>.
        </p>

        <h2>9. Children</h2>
        <p>
          The Service is not directed to children under 13. We do not knowingly collect personal
          information from children under 13.
        </p>

        <h2>10. Changes</h2>
        <p>
          We will notify you of material changes to this Privacy Policy via email or in-app notice at
          least 14 days before they take effect.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions? Contact us at <a href="mailto:privacy@xbar.app">privacy@xbar.app</a> or write to:<br />
          XBAR LLC, Privacy Team, Texas, USA
        </p>
      </main>
      <footer className="legal-page__footer">
        <span>© {new Date().getFullYear()} XBAR LLC™ · All rights reserved</span>
        <span>·</span>
        <Link to="/privacy">Privacy Policy</Link>
        <span>·</span>
        <Link to="/terms">Terms of Service</Link>
      </footer>
    </div>
  );
}

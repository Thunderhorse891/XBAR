import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div className="legal-page">
      <header className="legal-page__header">
        <Link to="/" className="legal-page__back">← XBAR</Link>
      </header>
      <main className="legal-page__body">
        <h1>Terms of Service</h1>
        <p className="legal-page__effective">Effective date: June 1, 2025</p>

        <h2>1. Agreement</h2>
        <p>
          By accessing or using the XBAR Ranch Platform ("Service"), operated by XBAR LLC ("XBAR", "we", "us"),
          you agree to these Terms of Service. If you are using the Service on behalf of an organization,
          you represent that you have authority to bind that organization to these Terms.
        </p>

        <h2>2. Service Description</h2>
        <p>
          XBAR provides ranch management software for horse operations, including record-keeping, document
          management, ownership tracking, and buyer-facing listing tools. The Service is provided "as is"
          for management and informational purposes only.
        </p>

        <h2>3. Accounts and Access</h2>
        <p>
          You are responsible for maintaining the confidentiality of your credentials. You must notify XBAR
          immediately of any unauthorized use. We reserve the right to suspend accounts that violate these
          Terms or that we reasonably believe are being used fraudulently.
        </p>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Upload false, misleading, or fraudulent information about horses or transactions</li>
          <li>Use the Service to facilitate any illegal transaction</li>
          <li>Attempt to reverse-engineer, scrape, or disrupt the Service</li>
          <li>Share your account credentials with unauthorized parties</li>
        </ul>

        <h2>5. Buyer Profile Listings</h2>
        <p>
          Shared buyer profiles are generated from data entered by the seller. XBAR does not independently
          verify health records, ownership history, registration data, or valuations. Buyers should conduct
          their own due diligence before any purchase.
        </p>

        <h2>6. Data and Privacy</h2>
        <p>
          Your use of the Service is also governed by our <Link to="/privacy">Privacy Policy</Link>, which
          is incorporated into these Terms by reference.
        </p>

        <h2>7. Subscriptions and Billing</h2>
        <p>
          Paid plans are billed monthly or annually as selected at checkout. Cancellations take effect at
          the end of the current billing period. XBAR does not provide refunds for partial periods except
          as required by applicable law.
        </p>

        <h2>8. Intellectual Property</h2>
        <p>
          All content, trademarks, and software comprising the Service are owned by XBAR LLC or its
          licensors. "XBAR" and the XBAR logo are trademarks of XBAR LLC. You may not use them without
          prior written permission.
        </p>

        <h2>9. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
          WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. XBAR DOES
          NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE OR UNINTERRUPTED.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, XBAR'S TOTAL LIABILITY ARISING OUT OF OR RELATED TO
          THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE FEES PAID BY YOU IN THE TWELVE (12) MONTHS
          PRECEDING THE CLAIM.
        </p>

        <h2>11. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Texas, without regard to conflict-of-law
          principles. Any disputes shall be resolved in the state or federal courts located in Texas.
        </p>

        <h2>12. Changes</h2>
        <p>
          We may update these Terms from time to time. We will notify you by email or in-app notice at
          least 14 days before material changes take effect. Continued use of the Service constitutes
          acceptance of the updated Terms.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these Terms? Contact us at <a href="mailto:legal@xbar.app">legal@xbar.app</a>.
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

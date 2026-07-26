import { Link, useParams } from 'react-router-dom';
import { legalDocuments, legalDocumentById, type LegalDocumentId } from '@/lib/legalDocuments';
import './legalReader.css';

// In-app legal reader.
//
// The Documents page already offers "preview / print" and "download" for these
// documents, but both go through a popup window or an <a download> click —
// neither of which does anything inside an iOS WKWebView. Apple also requires
// the privacy policy and terms to be readable in the app itself, before and
// after sign-in, so this route renders the same source directly in React and
// sits outside the authenticated shell.

function isLegalDocumentId(value: string | undefined): value is LegalDocumentId {
  return Boolean(value && value in legalDocumentById);
}

export default function Legal() {
  const { documentId } = useParams();
  const active = isLegalDocumentId(documentId) ? legalDocumentById[documentId] : null;

  return (
    <main className="legal-reader">
      <header className="legal-reader__head">
        <Link className="legal-reader__back" to={active ? '/legal' : '/'}>
          {active ? '← All documents' : '← Back to XBAR'}
        </Link>
        <h1>{active ? active.title : 'Legal & privacy'}</h1>
        <p className="legal-reader__meta">
          XBAR LLC™ · Last updated {active ? active.lastUpdated : legalDocuments[0].lastUpdated}
        </p>
      </header>

      {active ? (
        <article className="legal-reader__doc">
          <p className="legal-reader__notice">
            <strong>Review notice:</strong> {active.notice}
          </p>
          {active.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
      ) : (
        <nav className="legal-reader__index" aria-label="Legal documents">
          {legalDocuments.map((legalDoc) => (
            <Link className="legal-reader__card" key={legalDoc.id} to={`/legal/${legalDoc.id}`}>
              <strong>{legalDoc.shortTitle}</strong>
              <span>{legalDoc.purpose}</span>
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}

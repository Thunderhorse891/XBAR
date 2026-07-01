import { getLegalDocument } from '@/lib/legalDocuments';

export default function Terms() {
  const terms = getLegalDocument('terms');

  return (
    <main className="xbar-legal-route">
      <p className="xbar-legal-route__eyebrow">Documentation / Terms</p>
      <h1>{terms.title}</h1>
      <p className="xbar-legal-route__meta">Last updated: {terms.lastUpdated}</p>
      <p className="xbar-legal-route__notice">{terms.notice}</p>
      {terms.sections.map((section, index) => (
        <section key={section.title}>
          <h2>{String(index + 1).padStart(2, '0')}. {section.title}</h2>
          {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
    </main>
  );
}

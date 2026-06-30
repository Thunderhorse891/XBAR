import { getLegalDocument } from '@/lib/legalDocuments';

export default function Privacy() {
  const privacy = getLegalDocument('privacy');

  return (
    <main className="xbar-legal-route">
      <p className="xbar-legal-route__eyebrow">Documentation / Privacy</p>
      <h1>{privacy.title}</h1>
      <p className="xbar-legal-route__meta">Last updated: {privacy.lastUpdated}</p>
      <p className="xbar-legal-route__notice">{privacy.notice}</p>
      {privacy.sections.map((section, index) => (
        <section key={section.title}>
          <h2>{String(index + 1).padStart(2, '0')}. {section.title}</h2>
          {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
    </main>
  );
}

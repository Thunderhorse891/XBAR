import { getLegalDocument } from '@/lib/legalDocuments';

export default function Privacy() {
  const privacy = getLegalDocument('privacy');

  return (
    <main style={{ maxWidth: '860px', margin: '0 auto', padding: 'clamp(32px,6vw,80px) clamp(16px,4vw,40px)', color: '#e8f2ff', fontFamily: 'inherit' }}>
      <p style={{ color: '#65a6ff', fontSize: '11px', fontWeight: 800, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: '10px' }}>XBAR LLC(TM)</p>
      <h1 style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '8px' }}>{privacy.title}</h1>
      <p style={{ color: 'rgba(140,175,210,0.72)', marginBottom: '18px', fontSize: '13px' }}>Last updated: {privacy.lastUpdated}</p>
      <p style={{ border: '1px solid rgba(77,148,255,0.28)', background: 'rgba(8,19,34,0.88)', borderRadius: '14px', padding: '14px', color: 'rgba(200,223,240,0.82)', lineHeight: 1.7, fontSize: '14px', marginBottom: '34px' }}>{privacy.notice}</p>
      {privacy.sections.map((section) => (
        <section key={section.title} style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '8px', color: '#c8dff0' }}>{section.title}</h2>
          {section.body.map((paragraph) => <p key={paragraph} style={{ color: 'rgba(175,205,235,0.72)', lineHeight: 1.7, fontSize: '14px' }}>{paragraph}</p>)}
        </section>
      ))}
    </main>
  );
}

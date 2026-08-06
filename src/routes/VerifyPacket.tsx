import { type FormEvent, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Loader2, Search, ShieldAlert, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type VerifyResult, verifyPacket } from '@/lib/buyerVerify';
import './verifyPacket.css';

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso || '—';
  return new Date(parsed).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="verify-fact">
      <span className="verify-fact__label">{label}</span>
      <span className="verify-fact__value">{value}</span>
    </div>
  );
}

export default function VerifyPacket() {
  const params = useParams<{ packetId?: string }>();
  const [search] = useSearchParams();
  const initialId = params.packetId || search.get('packetId') || search.get('code') || '';

  const [code, setCode] = useState(initialId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run(id: string) {
    setLoading(true);
    setResult(null);
    const outcome = await verifyPacket(id);
    setResult(outcome);
    setLoading(false);
  }

  // Auto-verify when the page is opened with a code in the URL.
  useEffect(() => {
    if (initialId) void run(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!loading) void run(code);
  };

  return (
    <div className="verify-page">
      <div className="verify-card">
        <header className="verify-head">
          <div className="verify-mark" aria-hidden="true">
            <BadgeCheck size={26} />
          </div>
          <div>
            <h1 className="verify-title">Verify a sale packet</h1>
            <p className="verify-sub">
              Check a horse sale packet against XBAR’s own sealed record. The seal is computed on our servers from the
              seller’s records — so if a packet was altered after it was sealed, what you see here won’t match the copy
              you were sent.
            </p>
          </div>
        </header>

        <form className="verify-form" onSubmit={onSubmit}>
          <label className="verify-label" htmlFor="verify-code">
            Packet code
          </label>
          <div className="verify-input-row">
            <Input
              id="verify-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="packet-… (from the sale packet)"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={loading || !code.trim()}>
              {loading ? <Loader2 className="verify-spin" size={16} /> : <Search size={16} />}
              {loading ? 'Checking…' : 'Verify'}
            </Button>
          </div>
        </form>

        {result?.state === 'verified' && (
          <section className="verify-result verify-result--ok" aria-live="polite">
            <div className="verify-result__head">
              <BadgeCheck size={22} />
              <div>
                <strong>Sealed by XBAR — unaltered</strong>
                <span>Sealed on {formatDate(result.seal.sealedAt)}</span>
              </div>
            </div>
            <div className="verify-seal-code">{result.seal.sealCode}</div>
            <p className="verify-note">
              These are the facts XBAR sealed for this packet. Compare them to the copy you were sent — anything
              different means the packet was changed after sealing.
            </p>
            <div className="verify-facts">
              <Row label="Horse" value={result.facts.horseName} />
              <Row label="Barn name" value={result.facts.barnName} />
              <Row label="Breed" value={result.facts.breed} />
              <Row label="Sex" value={result.facts.sex} />
              <Row label="Color" value={result.facts.color} />
              <Row
                label="Registration"
                value={[result.facts.registry, result.facts.registrationNumber].filter(Boolean).join(' ')}
              />
              <Row label="Legal owner" value={result.facts.legalOwner} />
              <Row label="Transfer status" value={result.facts.transferStatus} />
              <Row label="Documents sealed" value={String(result.facts.documents.length)} />
            </div>
            {result.facts.documents.length > 0 && (
              <ul className="verify-docs">
                {result.facts.documents.map((doc, index) => (
                  <li key={`${doc.type}-${index}`}>
                    <span className="verify-docs__type">{doc.type}</span>
                    {doc.title}
                  </li>
                ))}
              </ul>
            )}
            <p className="verify-fine">
              Full seal digest (SHA-256): <code>{result.seal.digest}</code>
            </p>
          </section>
        )}

        {result?.state === 'unanchored' && (
          <section className="verify-result verify-result--warn" aria-live="polite">
            <ShieldAlert size={22} />
            <div>
              <strong>No sealed record</strong>
              <span>{result.message}</span>
            </div>
          </section>
        )}

        {result?.state === 'not-found' && (
          <section className="verify-result verify-result--warn" aria-live="polite">
            <ShieldAlert size={22} />
            <div>
              <strong>Not found</strong>
              <span>{result.message}</span>
            </div>
          </section>
        )}

        {result?.state === 'error' && (
          <section className="verify-result verify-result--err" aria-live="polite">
            <ShieldX size={22} />
            <div>
              <strong>Could not verify</strong>
              <span>{result.message}</span>
            </div>
          </section>
        )}

        <footer className="verify-foot">
          XBAR seals what the seller’s records said at the moment the packet was made. It does not independently
          appraise the horse or guarantee the underlying records are true — always confirm ownership, health, and terms
          before you pay.
        </footer>
      </div>
    </div>
  );
}

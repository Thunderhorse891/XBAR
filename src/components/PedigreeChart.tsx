import type { BloodlineProfile } from '@/types/xbar';

function PedigreeNode({ name, relationship }: { name: string; relationship: string }) {
  return (
    <div className="pedigree-node">
      <span className="pedigree-node__role">{relationship}</span>
      <span className="pedigree-node__name">{name || '—'}</span>
    </div>
  );
}

export function PedigreeChart({ bloodline, horseName }: { bloodline: BloodlineProfile; horseName: string }) {
  const hasSire = Boolean(bloodline.sire);
  const hasDam = Boolean(bloodline.dam);
  const hasGrandparents = Boolean(bloodline.sireSire || bloodline.sireDam || bloodline.damSire || bloodline.damDam);

  if (!hasSire && !hasDam) return null;

  return (
    <div
      className="pedigree-chart"
      role="img"
      aria-label={`Pedigree chart for ${horseName}`}
    >
      {/* Generation 0 — subject horse */}
      <div className="pedigree-col pedigree-col--subject">
        <PedigreeNode name={horseName} relationship="Horse" />
      </div>

      {/* Generation 1 — sire / dam */}
      <div className="pedigree-col pedigree-col--parents">
        <PedigreeNode name={bloodline.sire} relationship="Sire" />
        <PedigreeNode name={bloodline.dam} relationship="Dam" />
      </div>

      {/* Generation 2 — grandparents */}
      {hasGrandparents && (
        <div className="pedigree-col pedigree-col--grandparents">
          <PedigreeNode name={bloodline.sireSire ?? ''} relationship="Sire's Sire" />
          <PedigreeNode name={bloodline.sireDam ?? ''} relationship="Sire's Dam" />
          <PedigreeNode name={bloodline.damSire ?? ''} relationship="Dam's Sire" />
          <PedigreeNode name={bloodline.damDam ?? ''} relationship="Dam's Dam" />
        </div>
      )}
    </div>
  );
}

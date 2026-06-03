import type { BloodlineProfile } from '@/types/xbar';

function PedigreeNode({ name, role }: { name: string; role: string }) {
  return (
    <div className="pedigree-node">
      <span className="pedigree-node__role">{role}</span>
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
    <div className="pedigree-chart">
      {/* Generation 0 — subject horse */}
      <div className="pedigree-col pedigree-col--subject">
        <PedigreeNode name={horseName} role="Horse" />
      </div>

      {/* Generation 1 — sire / dam */}
      <div className="pedigree-col pedigree-col--parents">
        <PedigreeNode name={bloodline.sire} role="Sire" />
        <PedigreeNode name={bloodline.dam} role="Dam" />
      </div>

      {/* Generation 2 — grandparents */}
      {hasGrandparents && (
        <div className="pedigree-col pedigree-col--grandparents">
          <PedigreeNode name={bloodline.sireSire ?? ''} role="Sire's Sire" />
          <PedigreeNode name={bloodline.sireDam ?? ''} role="Sire's Dam" />
          <PedigreeNode name={bloodline.damSire ?? ''} role="Dam's Sire" />
          <PedigreeNode name={bloodline.damDam ?? ''} role="Dam's Dam" />
        </div>
      )}
    </div>
  );
}

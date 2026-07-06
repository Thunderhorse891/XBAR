import { Link } from 'react-router-dom';
import { PageHeader, Panel } from '@/components/app-ui';

export default function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="Page not found"
        description="The route you opened does not exist in this workspace."
      />

      <Panel
        title="Return to a live module"
        description="Use one of the primary product areas instead of landing in a blank shell."
      >
        <div className="inline-actions">
          <Link to="/" className="button button--primary">
            Dashboard
          </Link>
          <Link to="/horses" className="button button--ghost">
            Horses
          </Link>
          <Link to="/documents" className="button button--ghost">
            Documents
          </Link>
        </div>
      </Panel>
    </>
  );
}

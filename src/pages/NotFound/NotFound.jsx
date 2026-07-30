import { Link } from 'react-router-dom';
import Button from '../../components/common/Button.jsx';

function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="text-center max-w-sm">
        <p className="text-6xl mb-4">🐠</p>
        <h1 className="text-xl font-semibold text-slate-100 mb-2">Page not found</h1>
        <p className="text-sm text-slate-400 mb-6">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <Link to="/">
          <Button variant="primary">Back to login</Button>
        </Link>
      </div>
    </div>
  );
}

export default NotFound;

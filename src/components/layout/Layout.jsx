import Navbar from './Navbar.jsx';

function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100">
      <Navbar />
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}

export default Layout;

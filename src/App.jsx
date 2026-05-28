import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import LandingPage from './LandingPage';
import QuoteFlow from './QuoteFlow';
import Dashboard from './Dashboard';
import Settings from './Settings';
import Pool from './Pool';
import Admin from './Admin';
import PolicyDetail from './PolicyDetail';
import ApiDocs from './ApiDocs';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { arcaApi, configureArcaAuth, DEMO_USER_ID } from './lib/api';
import './index.css';
import logoImg from './assets/logo.png';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmpijscdo00f20cjxjq3bflcp';

function ArcaSessionBridge() {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const [lastUserId, setLastUserId] = useState(DEMO_USER_ID);

  useEffect(() => {
    if (!ready || !authenticated) {
      configureArcaAuth({ userId: DEMO_USER_ID });
      setLastUserId(DEMO_USER_ID);
      return;
    }

    let cancelled = false;
    configureArcaAuth({ getAccessToken, userId: lastUserId });

    const syncSession = async () => {
      try {
        const session = await arcaApi.getAuthMe();
        let nextUser = session?.user;

        if (!nextUser && user?.email?.address) {
          nextUser = await arcaApi.createUser({
            email: user.email.address,
            phone: user.phone?.number || null,
            rialo_address: user.wallet?.address || null,
          });
        }

        if (!cancelled && nextUser?.id) {
          configureArcaAuth({ getAccessToken, userId: nextUser.id });
          setLastUserId(nextUser.id);
        }
      } catch (error) {
        console.warn('Arca session sync failed; using demo user until API auth is available:', error);
        if (!cancelled) {
          configureArcaAuth({ getAccessToken, userId: DEMO_USER_ID });
          setLastUserId(DEMO_USER_ID);
        }
      }
    };

    syncSession();
    const intervalId = window.setInterval(syncSession, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authenticated, getAccessToken, lastUserId, ready, user?.email?.address, user?.phone?.number, user?.wallet?.address]);

  return null;
}

function ProtectedRoute({ children }) {
  const { ready, authenticated } = usePrivy();
  
  if (!ready) return null; 
  
  if (!authenticated) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function Nav() {
  const { ready, authenticated, logout, user, login } = usePrivy();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
    <div className="ambient-glow"></div>
    <nav className="absolute top-0 w-full p-4 md:p-6 md:px-12 flex justify-between items-center z-50">
      <Link to="/" className="flex items-center group">
        <img src={logoImg} alt="Arca Logo" className="h-10 md:h-14 object-contain group-hover:opacity-80 transition-opacity" />
      </Link>
      
      {ready && authenticated ? (
        <>
          <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 gap-10 text-xs font-semibold tracking-widest uppercase opacity-70">
            <Link to="/" className="hover:text-[#a9ddd3] text-[#e8e3d5] hover:opacity-100 transition-all">Protocol</Link>
            <Link to="/dashboard" className="hover:text-[#a9ddd3] text-[#e8e3d5] hover:opacity-100 transition-all">Dashboard</Link>
            <Link to="/pool" className="hover:text-[#a9ddd3] text-[#e8e3d5] hover:opacity-100 transition-all">Pool</Link>
            <Link to="/admin" className="hover:text-red-400 text-red-500/80 hover:opacity-100 transition-all">Oracle</Link>
            <Link to="/settings" className="hover:text-[#a9ddd3] text-[#e8e3d5] hover:opacity-100 transition-all">Settings</Link>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <span className="hidden lg:block text-[10px] text-[#e8e3d5]/40 tracking-widest font-mono">
              {user?.email?.address || 'User'}
            </span>
            <button onClick={() => navigate('/quote')} className="px-3 md:px-4 py-1.5 md:py-2 rounded-md bg-white/5 hover:bg-[#a9ddd3]/10 border border-white/10 hover:border-[#a9ddd3]/50 text-[#a9ddd3] text-[9px] md:text-[10px] font-bold tracking-widest uppercase transition-all backdrop-blur-md whitespace-nowrap">
              + New
            </button>
            <button onClick={handleLogout} className="hidden md:block px-3 md:px-4 py-1.5 md:py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[#e8e3d5] text-[9px] md:text-[10px] font-bold tracking-widest uppercase transition-all backdrop-blur-md whitespace-nowrap">
              Sign Out
            </button>
          </div>
        </>
      ) : (
        <button onClick={login} className="px-4 md:px-6 py-2 md:py-2.5 rounded-md bg-white/5 hover:bg-[#a9ddd3] border border-white/10 hover:border-[#a9ddd3] text-white hover:text-[#040507] text-[10px] md:text-xs font-bold tracking-widest uppercase transition-all duration-300 backdrop-blur-md">
          Sign In
        </button>
      )}
    </nav>

    {/* Mobile Bottom Navigation */}
    {ready && authenticated && (
      <div className="md:hidden fixed bottom-0 w-full bg-[#040507]/90 backdrop-blur-xl border-t border-[#e8e3d5]/10 z-50 px-4 py-4 flex justify-between items-center text-[9px] uppercase tracking-widest font-bold">
        <Link to="/" className="flex flex-col items-center gap-1 text-[#e8e3d5]/50 hover:text-[#a9ddd3] transition-colors">
          <span>Home</span>
        </Link>
        <Link to="/dashboard" className="flex flex-col items-center gap-1 text-[#e8e3d5]/50 hover:text-[#a9ddd3] transition-colors">
          <span>Dash</span>
        </Link>
        <Link to="/pool" className="flex flex-col items-center gap-1 text-[#e8e3d5]/50 hover:text-[#a9ddd3] transition-colors">
          <span>Pool</span>
        </Link>
        <Link to="/admin" className="flex flex-col items-center gap-1 text-red-500/50 hover:text-red-400 transition-colors">
          <span>Oracle</span>
        </Link>
        <Link to="/settings" className="flex flex-col items-center gap-1 text-[#e8e3d5]/50 hover:text-[#a9ddd3] transition-colors">
          <span>Settings</span>
        </Link>
        <button onClick={handleLogout} className="flex flex-col items-center gap-1 text-red-400/50 hover:text-red-400 transition-colors">
          <span>Log Out</span>
        </button>
      </div>
    )}
    </>
  );
}

function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'dark',
          accentColor: '#a9ddd3',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <Router>
        <ArcaSessionBridge />
        <div className="min-h-screen text-[#e8e3d5] font-sans selection:bg-[#a9ddd3] selection:text-[#040507]">
          <Nav />

          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/quote" element={<ProtectedRoute><QuoteFlow /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/policy/:id" element={<ProtectedRoute><PolicyDetail /></ProtectedRoute>} />
            <Route path="/pool" element={<ProtectedRoute><Pool /></ProtectedRoute>} />
            <Route path="/api-docs" element={<ProtectedRoute><ApiDocs /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          </Routes>
        </div>
      </Router>
    </PrivyProvider>
  );
}

export default App;

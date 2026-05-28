import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallets } from '@privy-io/react-auth';
import { arcaApi, toBackendQuoteRequest } from './lib/api';
import { createPolicy, formatAddress } from './lib/policies';

import flightImg from './assets/plane.jpg';
import weatherImg from './assets/farmers.jpg';
import logisticsImg from './assets/cargo.jpg';

export default function QuoteFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const { wallets } = useWallets();
  const [category, setCategory] = useState(location.state?.category || 'flight');

  const [step, setStep] = useState(1);

  // Form States
  const [flightNo, setFlightNo] = useState('BA-112');
  const [date, setDate] = useState('2026-05-24');
  
  const [farmLocation, setFarmLocation] = useState('93721 (Fresno, CA)');
  const [rainfall, setRainfall] = useState('10');
  
  const [trackingId, setTrackingId] = useState('AWB-8839210');
  const [maxTransit, setMaxTransit] = useState('48');

  // Dynamic Quote State
  const [dynamicQuote, setDynamicQuote] = useState(null);
  const [deployedPolicy, setDeployedPolicy] = useState(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployNotice, setDeployNotice] = useState('');

  const handleAnalyze = (e) => {
    e.preventDefault();
    setStep(2);
  };

  const executeOracleQuery = useCallback(async () => {
    try {
      if (category === 'weather') {
        const backendQuote = await arcaApi.createQuote(toBackendQuoteRequest({ category, flightNo, farmLocation, rainfall, trackingId, maxTransit }));
        
        // Wait a bit just for cinematic UX
        await new Promise(r => setTimeout(r, 1500));

        setDynamicQuote({
          ...backendQuote,
          premium: Number(backendQuote.premium).toFixed(2),
          payout: Number(backendQuote.payout).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      } else if (category === 'logistics') {
        const backendQuote = await arcaApi.createQuote(toBackendQuoteRequest({ category, flightNo, farmLocation, rainfall, trackingId, maxTransit }));
        await new Promise(r => setTimeout(r, 1500));
        setDynamicQuote({
          ...backendQuote,
          premium: Number(backendQuote.premium).toFixed(2),
          payout: Number(backendQuote.payout).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      } else {
        const backendQuote = await arcaApi.createQuote(toBackendQuoteRequest({ category, flightNo, farmLocation, rainfall, trackingId, maxTransit }));
        await new Promise(r => setTimeout(r, 1500));
        setDynamicQuote({
          ...backendQuote,
          premium: Number(backendQuote.premium).toFixed(2),
          payout: Number(backendQuote.payout).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      }
      setStep(3);
    } catch (error) {
      console.error("Oracle fetch failed:", error);
      // Fallback if network fails
      setDynamicQuote({
        premium: '50.00', payout: '1,000.00', trigger: 'Fallback Metric', engine: 'Fallback Local Engine', oracle: 'System Fallback'
      });
      setStep(3);
    }
  }, [category, farmLocation, flightNo, maxTransit, rainfall, trackingId]);

  useEffect(() => {
    if (step === 2) {
      executeOracleQuery();
    }
  }, [executeOracleQuery, step]);

  const requestWalletApproval = async () => {
    const wallet = wallets[0];
    const approvalMessage = `Approve Arca Policy Setup\nRisk Category: ${category.toUpperCase()}\nPremium: ${dynamicQuote.premium} USDC\nMode: Demo monitoring rail`;

    if (!wallet) return 'No embedded wallet available; continuing in demo mode.';

    try {
      if (typeof wallet.signMessage === 'function') {
        await wallet.signMessage(approvalMessage);
      return 'Wallet approval captured for demo policy setup.';
      }

      if (typeof wallet.getEthereumProvider === 'function') {
        const provider = await wallet.getEthereumProvider();
        const address = wallet.address || provider.selectedAddress;
        if (address) {
          await provider.request({
            method: 'personal_sign',
            params: [approvalMessage, address],
          });
          return 'Wallet approval captured for demo policy setup.';
        }
      }

      return 'Wallet signing unavailable; continuing in demo mode.';
    } catch (error) {
      console.warn('Wallet approval skipped:', error);
      return 'Wallet approval skipped; continuing in demo mode.';
    }
  };

  const handleDeploy = async () => {
    if (!dynamicQuote || isDeploying) return;

    setIsDeploying(true);
    setDeployNotice('');

    try {
      const approvalNotice = await requestWalletApproval();
      setDeployNotice(approvalNotice);
      let policy;
      try {
        const backendQuote = {
          ...dynamicQuote,
          premium: Number(String(dynamicQuote.premium).replaceAll(',', '')),
          payout: Number(String(dynamicQuote.payout).replaceAll(',', '')),
        };
        const backendPolicy = await arcaApi.createPolicy(backendQuote);
        policy = {
          id: backendPolicy.id,
          contractAddress: backendPolicy.contract_address,
        };
      } catch (apiError) {
        console.warn('API policy deployment failed, using local fallback:', apiError);
        policy = createPolicy({
          category,
          quote: dynamicQuote,
          inputs: { flightNo, date, farmLocation, rainfall, trackingId, maxTransit },
        });
      }
      setDeployedPolicy(policy);
      setStep(4);
      setTimeout(() => navigate(`/policy/${policy.id}`), 3500);
    } catch (error) {
      console.error('Policy deployment failed:', error);
      setDeployNotice('Policy deployment failed. Please try again.');
      setIsDeploying(false);
    }
  };

  const getBackgroundImg = () => {
    if (category === 'weather') return weatherImg;
    if (category === 'logistics') return logisticsImg;
    return flightImg;
  };

  const getOracleText = () => {
    if (category === 'weather') return { title: 'Querying Weather Feed', desc: `Fetching provider-backed Open-Meteo precipitation data for ${farmLocation}...` };
    if (category === 'logistics') return { title: 'Simulating Carrier SLA', desc: `Analyzing Arca transit SLA conditions for ${trackingId}...` };
    return { title: 'Querying Aviation Feed', desc: `Fetching provider-backed delay metrics for ${flightNo}...` };
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden flex flex-col justify-between">
      {/* Dynamic Background */}
      <div 
        className="absolute inset-0 object-cover opacity-60 transition-all duration-1000"
        style={{ backgroundImage: `url(${getBackgroundImg()})`, backgroundPosition: 'center', backgroundSize: 'cover' }}
      />
      <div className="bg-overlay"></div>

      <div className="pt-24 md:pt-32"></div>

      <main className="z-10 flex-1 flex flex-col items-center justify-center text-center px-4 md:px-6 w-full max-w-xl mx-auto relative pt-12 md:pt-16">
        <button onClick={() => navigate('/dashboard')} className="absolute top-0 left-4 md:left-0 flex items-center gap-2 text-[#e8e3d5]/50 hover:text-[#a9ddd3] text-[10px] font-bold tracking-widest uppercase transition-colors z-50">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Return to Dashboard
        </button>

        {step === 1 && (
          <div className="glass-panel p-6 md:p-8 w-full animate-fade-up border-t border-t-[#a9ddd3]/30">
            <h2 className="text-xl md:text-2xl font-bold tracking-widest uppercase text-[#e8e3d5] mb-2">Parameter Setup</h2>
            <p className="text-[10px] md:text-xs text-[#e8e3d5]/50 tracking-widest uppercase mb-6">Set up a monitored demo policy</p>
            
            <div className="flex bg-[#040507]/60 p-1 rounded-lg border border-[#e8e3d5]/10 mb-6 md:mb-8">
              <button 
                onClick={() => setCategory('flight')}
                className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase rounded transition-all ${category === 'flight' ? 'bg-[#a9ddd3] text-[#040507] shadow-sm' : 'text-[#e8e3d5]/50 hover:text-[#e8e3d5]'}`}
              >
                Aviation
              </button>
              <button 
                onClick={() => setCategory('weather')}
                className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase rounded transition-all ${category === 'weather' ? 'bg-[#a9ddd3] text-[#040507] shadow-sm' : 'text-[#e8e3d5]/50 hover:text-[#e8e3d5]'}`}
              >
                Weather
              </button>
              <button 
                onClick={() => setCategory('logistics')}
                className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase rounded transition-all ${category === 'logistics' ? 'bg-[#a9ddd3] text-[#040507] shadow-sm' : 'text-[#e8e3d5]/50 hover:text-[#e8e3d5]'}`}
              >
                Logistics
              </button>
            </div>

            <form onSubmit={handleAnalyze} className="flex flex-col gap-5 md:gap-6 text-left">
              
              {category === 'weather' && (
                <div className="space-y-4 animate-fade-up">
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">Farm Location (Zip / Region)</label>
                    <input type="text" value={farmLocation} onChange={(e) => setFarmLocation(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all text-sm shadow-inner" required />
                  </div>
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">Critical Rainfall Threshold (30 Days)</label>
                    <div className="relative">
                      <input type="number" value={rainfall} onChange={(e) => setRainfall(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all text-sm shadow-inner" required />
                      <span className="absolute right-4 top-4 text-[#e8e3d5]/40 text-sm font-mono">&lt; mm</span>
                    </div>
                  </div>
                </div>
              )}

              {category === 'logistics' && (
                <div className="space-y-4 animate-fade-up">
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">Shipment Tracking ID (AWB)</label>
                    <input type="text" value={trackingId} onChange={(e) => setTrackingId(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all text-sm shadow-inner" required />
                  </div>
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">SLA Max Transit Time</label>
                    <div className="relative">
                      <input type="number" value={maxTransit} onChange={(e) => setMaxTransit(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all text-sm shadow-inner" required />
                      <span className="absolute right-4 top-4 text-[#e8e3d5]/40 text-[10px] tracking-widest uppercase mt-0.5">Hours</span>
                    </div>
                  </div>
                </div>
              )}

              {category === 'flight' && (
                <div className="space-y-4 animate-fade-up">
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">Flight Number</label>
                    <input type="text" value={flightNo} onChange={(e) => setFlightNo(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all text-sm shadow-inner" required />
                  </div>
                  <div>
                    <label className="block text-[9px] md:text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">Departure Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-[#040507]/80 border border-white/10 rounded-lg p-4 text-[#e8e3d5] font-mono focus:outline-none focus:border-[#a9ddd3] focus:ring-1 focus:ring-[#a9ddd3] transition-all [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert text-sm shadow-inner" required />
                  </div>
                </div>
              )}
              
              <button type="submit" className="mt-4 w-full py-4 bg-[#a9ddd3] hover:bg-[#a9ddd3]/90 text-[#040507] font-bold text-[10px] tracking-widest uppercase rounded-md transition-all shadow-[0_0_20px_rgba(169,221,211,0.2)]">
                Analyze Risk & Generate Quote
              </button>
            </form>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col items-center animate-fade-up w-full px-4">
            <div className="relative w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-8">
              <div className="absolute inset-0 rounded-full border border-dashed border-[#a9ddd3]/40 animate-spin-slow"></div>
              <div className="absolute inset-2 rounded-full border border-t-[#a9ddd3]/60 border-r-transparent border-b-transparent border-l-transparent animate-spin-reverse"></div>
              <div className="w-3 h-3 bg-[#a9ddd3] rounded-full animate-ping"></div>
            </div>
            <h2 className="text-base md:text-lg font-bold tracking-widest uppercase text-[#a9ddd3] mb-2">{getOracleText().title}</h2>
            <p className="text-[9px] md:text-[10px] text-[#e8e3d5]/50 tracking-widest uppercase font-mono px-4 text-center">{getOracleText().desc}</p>
          </div>
        )}

        {step === 3 && dynamicQuote && (
          <div className="glass-panel p-6 md:p-10 w-full animate-fade-up border-t border-t-[#a9ddd3]/50 shadow-[0_0_50px_rgba(169,221,211,0.1)]">
            <h2 className="text-xl md:text-3xl font-bold tracking-widest uppercase text-[#e8e3d5] mb-2">Parametric Quote</h2>
            <p className="text-[9px] md:text-[10px] text-[#a9ddd3] tracking-widest uppercase mb-6 md:mb-8 font-bold">Risk metrics locked from the current provider feed.</p>
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-black/40 border border-[#a9ddd3]/30 rounded-xl p-6 md:p-8 mb-6 gap-4 sm:gap-0 shadow-inner">
              <div className="text-left w-full sm:w-auto">
                <div className="text-[8px] md:text-[9px] font-bold text-[#e8e3d5]/50 tracking-widest uppercase mb-2">Premium Cost</div>
                <div className="text-3xl md:text-4xl font-bold text-[#e8e3d5] font-mono tracking-tight">{dynamicQuote.premium} <span className="text-sm md:text-base text-[#e8e3d5]/50">USDC</span></div>
              </div>
              <div className="hidden sm:block w-[1px] h-12 bg-gradient-to-b from-transparent via-[#e8e3d5]/20 to-transparent"></div>
              <div className="text-left sm:text-right w-full sm:w-auto">
                <div className="text-[8px] md:text-[9px] font-bold text-[#a9ddd3]/60 tracking-widest uppercase mb-2">Guaranteed Payout</div>
                <div className="text-3xl md:text-4xl font-bold text-[#a9ddd3] font-mono tracking-tight">{dynamicQuote.payout} <span className="text-sm md:text-base text-[#a9ddd3]/50">USDC</span></div>
              </div>
            </div>

            <div className="text-left text-[8px] md:text-[9px] text-[#e8e3d5]/40 tracking-widest uppercase font-mono mb-6 md:mb-8 space-y-2 md:space-y-3 bg-white/5 p-4 rounded border border-white/5 overflow-x-auto">
              <div className="flex flex-col md:flex-row md:justify-between whitespace-nowrap gap-1 md:gap-4"><span className="text-[#a9ddd3]/60">Trigger Condition:</span> <span className="text-[#e8e3d5]">{dynamicQuote.trigger}</span></div>
              <div className="flex flex-col md:flex-row md:justify-between whitespace-nowrap gap-1 md:gap-4"><span className="text-[#a9ddd3]/60">Risk Engine:</span> <span className="text-[#e8e3d5]">{dynamicQuote.engine}</span></div>
              <div className="flex flex-col md:flex-row md:justify-between whitespace-nowrap gap-1 md:gap-4"><span className="text-[#a9ddd3]/60">Oracle Source:</span> <span className="text-[#e8e3d5]">{dynamicQuote.oracle}</span></div>
            </div>

            {deployNotice && (
              <div className="mb-4 rounded-md border border-[#a9ddd3]/20 bg-[#a9ddd3]/10 px-4 py-3 text-[9px] md:text-[10px] text-[#a9ddd3] tracking-widest uppercase font-bold">
                {deployNotice}
              </div>
            )}

            <button onClick={handleDeploy} disabled={isDeploying} className="w-full py-4 bg-[#a9ddd3] hover:bg-[#e8e3d5] text-[#040507] font-bold text-[9px] md:text-[10px] tracking-widest uppercase rounded-md transition-all shadow-[0_0_20px_rgba(169,221,211,0.2)] disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2">
              {isDeploying && <span className="w-3 h-3 border-2 border-[#040507]/20 border-t-[#040507] rounded-full animate-spin"></span>}
              {isDeploying ? 'Preparing Policy...' : 'Create Policy Record'}
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center animate-fade-up px-4">
             <div className="w-16 h-16 md:w-20 md:h-20 rounded-full border border-[#a9ddd3] flex items-center justify-center mb-6 md:mb-8 shadow-[0_0_30px_rgba(169,221,211,0.3)] bg-[#a9ddd3]/5">
                <svg className="w-6 h-6 md:w-8 md:h-8 text-[#a9ddd3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
             </div>
             <h2 className="text-xl md:text-2xl font-bold tracking-widest uppercase text-[#e8e3d5] mb-2 text-center">Policy Active</h2>
             <p className="text-[9px] md:text-[10px] text-[#a9ddd3] tracking-widest uppercase font-mono text-center">
               Policy {formatAddress(deployedPolicy?.contractAddress)} created on the Arca demo rail
             </p>
          </div>
        )}
      </main>

      <div className="pb-12"></div>
    </div>
  )
}

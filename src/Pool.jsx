import { useState } from 'react';

export default function Pool() {
  const [stakingAmount, setStakingAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);
  const [staked, setStaked] = useState(false);

  const handleStake = (e) => {
    e.preventDefault();
    if (!stakingAmount || isNaN(stakingAmount)) return;
    setIsStaking(true);
    setTimeout(() => {
      setIsStaking(false);
      setStaked(true);
    }, 2500);
  };

  return (
    <div className="relative w-full min-h-screen flex flex-col pt-24 md:pt-32 pb-24 items-center bg-[#040507]">
      <main className="z-10 w-full max-w-2xl px-4 md:px-6 animate-fade-up">
        
        {/* Header */}
        <div className="flex flex-col items-center mb-10 md:mb-12 text-center">
          <div className="text-[10px] md:text-xs font-semibold tracking-widest uppercase text-[#e8e3d5]/50 mb-2">Total Value Locked</div>
          <div className="text-5xl md:text-6xl font-bold text-[#e8e3d5] font-mono tracking-tight flex items-baseline gap-2">
            24,500 <span className="text-xl md:text-2xl text-[#e8e3d5]/40 font-sans tracking-normal">USDC</span>
          </div>
          <div className="mt-4 px-4 py-1.5 bg-[#a9ddd3]/10 border border-[#a9ddd3]/30 rounded-full text-xs font-bold text-[#a9ddd3] tracking-widest uppercase flex items-center gap-2 shadow-[0_0_15px_rgba(169,221,211,0.1)]">
            <span className="w-2 h-2 bg-[#a9ddd3] rounded-full animate-pulse"></span>
            14.2% Base APY
          </div>
        </div>

        {/* Stake Card */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Provide Liquidity</h2>
          <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 overflow-hidden shadow-lg p-5 md:p-8">
            <form onSubmit={handleStake} className="flex flex-col gap-6">
              
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3]">Amount to Stake</label>
                  <span className="text-[10px] font-mono text-[#e8e3d5]/50">Wallet: 1,000 USDC</span>
                </div>
                <div className="relative">
                  <input 
                    type="number" 
                    value={stakingAmount} 
                    onChange={(e) => setStakingAmount(e.target.value)} 
                    placeholder="0.00"
                    disabled={staked}
                    className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-xl p-4 text-[#e8e3d5] font-mono text-xl focus:outline-none focus:border-[#a9ddd3] transition-colors disabled:opacity-50" 
                    required 
                  />
                  <button type="button" onClick={() => setStakingAmount('1000')} className="absolute right-4 top-4 text-[10px] font-bold tracking-widest uppercase text-[#a9ddd3] hover:text-white transition-colors bg-[#a9ddd3]/10 px-2 py-1 rounded">MAX</button>
                </div>
              </div>

              <div className="bg-[#040507]/40 rounded-xl p-4 border border-white/5 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-[#e8e3d5]/50">Estimated Daily Yield</span>
                  <span className="text-[#e8e3d5] font-mono">~{(stakingAmount * 0.142 / 365 || 0).toFixed(3)} USDC</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#e8e3d5]/50">Protocol Risk Ratio</span>
                  <span className="text-[#a9ddd3]">Safe (2.4x)</span>
                </div>
              </div>

              {!staked ? (
                <button 
                  type="submit"
                  disabled={isStaking || !stakingAmount}
                  className="w-full py-4 bg-[#a9ddd3] hover:bg-white text-[#040507] font-bold text-[10px] md:text-xs tracking-widest uppercase rounded-xl transition-all shadow-[0_4px_14px_rgba(169,221,211,0.2)] disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
                >
                  {isStaking ? (
                    <>
                      <span className="w-4 h-4 border-2 border-[#040507]/20 border-t-[#040507] rounded-full animate-spin"></span>
                      Confirming Transaction...
                    </>
                  ) : "Stake USDC"}
                </button>
              ) : (
                <div className="w-full py-4 bg-[#a9ddd3]/10 border border-[#a9ddd3]/30 text-[#a9ddd3] font-bold text-[10px] md:text-xs tracking-widest uppercase rounded-xl flex justify-center items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  Liquidity Locked Successfully
                </div>
              )}

            </form>
          </div>
        </div>

        {/* Global Pool Stats */}
        <div>
          <h2 className="text-sm font-semibold text-[#e8e3d5] mb-4">Arca Capital Efficiency</h2>
          <div className="grid grid-cols-2 gap-4">
             <div className="bg-[#e8e3d5]/5 rounded-xl border border-[#e8e3d5]/10 p-5 flex flex-col justify-center">
                <span className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/50 mb-1">Total Underwritten</span>
                <span className="text-xl font-bold font-mono text-[#e8e3d5]">10,200 USDC</span>
             </div>
             <div className="bg-[#e8e3d5]/5 rounded-xl border border-[#e8e3d5]/10 p-5 flex flex-col justify-center">
                <span className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/50 mb-1">Total Claims Paid</span>
                <span className="text-xl font-bold font-mono text-[#a9ddd3]">1,400 USDC</span>
             </div>
          </div>
        </div>

      </main>
    </div>
  );
}

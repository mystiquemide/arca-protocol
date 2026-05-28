import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';

import flightImg from './assets/plane.jpg';
import weatherImg from './assets/farmers.jpg';
import logisticsImg from './assets/cargo.jpg';

export default function LandingPage() {
  const [activeCategory, setActiveCategory] = useState('flight');
  const { authenticated, login } = usePrivy();
  const navigate = useNavigate();

  const handleSelect = (category) => {
    setActiveCategory(category);
    if (authenticated) {
      navigate('/quote', { state: { category } });
    } else {
      login();
    }
  };

  const getBackgroundImg = () => {
    if (activeCategory === 'weather') return weatherImg;
    if (activeCategory === 'logistics') return logisticsImg;
    return flightImg;
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden flex flex-col justify-between">
      
      {/* Cinematic Dynamic Background */}
      <div 
        className="absolute inset-0 object-cover opacity-50 transition-all duration-1000 scale-105"
        style={{ backgroundImage: `url(${getBackgroundImg()})`, backgroundPosition: 'center', backgroundSize: 'cover' }}
      />
      <div className="bg-overlay"></div>

      <div className="pt-24 md:pt-32"></div>

      <main className="z-10 flex-1 flex flex-col items-center justify-center text-center w-full relative">
        
        <h1 className="text-3xl md:text-5xl lg:text-7xl font-bold tracking-tighter text-[#e8e3d5] mb-8 md:mb-16 animate-fade-up max-w-4xl px-4 leading-tight">
          Insurance that pays <br className="hidden md:block"/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#e8e3d5] to-[#a9ddd3]">
            before you complain.
          </span>
        </h1>

        {/* Dynamic Category Selector for Mobile & Desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 max-w-5xl mx-auto w-full px-6 relative z-10 animate-fade-up delay-100 animate-float mb-12">
          
          <div 
            onMouseEnter={() => setActiveCategory('flight')}
            onClick={() => handleSelect('flight')}
            className={`cursor-pointer group relative overflow-hidden rounded-2xl transition-all duration-500 border ${activeCategory === 'flight' ? 'border-[#a9ddd3]/50 bg-[#a9ddd3]/[0.03] shadow-[0_0_40px_rgba(169,221,211,0.15)] shadow-inner' : 'border-white/[0.05] hover:border-white/[0.15] bg-black/20 hover:bg-black/40'} backdrop-blur-3xl h-32 md:h-48 flex flex-col items-center justify-center`}
          >
            <div className={`font-bold text-sm md:text-base tracking-widest uppercase transition-colors ${activeCategory === 'flight' ? 'text-[#a9ddd3]' : 'text-[#e8e3d5]/70 group-hover:text-[#e8e3d5]'}`}>Flight Delay</div>
            <div className={`text-[9px] md:text-[10px] font-semibold tracking-widest uppercase mt-2 transition-colors ${activeCategory === 'flight' ? 'text-[#a9ddd3]/70' : 'text-[#e8e3d5]/30'}`}>Instant Payouts</div>
          </div>

          <div 
            onMouseEnter={() => setActiveCategory('weather')}
            onClick={() => handleSelect('weather')}
            className={`cursor-pointer group relative overflow-hidden rounded-2xl transition-all duration-500 border ${activeCategory === 'weather' ? 'border-[#a9ddd3]/50 bg-[#a9ddd3]/[0.03] shadow-[0_0_40px_rgba(169,221,211,0.15)] shadow-inner' : 'border-white/[0.05] hover:border-white/[0.15] bg-black/20 hover:bg-black/40'} backdrop-blur-3xl h-32 md:h-48 flex flex-col items-center justify-center`}
          >
            <div className={`font-bold text-sm md:text-base tracking-widest uppercase transition-colors ${activeCategory === 'weather' ? 'text-[#a9ddd3]' : 'text-[#e8e3d5]/70 group-hover:text-[#e8e3d5]'}`}>Agriculture</div>
            <div className={`text-[9px] md:text-[10px] font-semibold tracking-widest uppercase mt-2 transition-colors ${activeCategory === 'weather' ? 'text-[#a9ddd3]/70' : 'text-[#e8e3d5]/30'}`}>Parametric Weather</div>
          </div>

          <div 
            onMouseEnter={() => setActiveCategory('logistics')}
            onClick={() => handleSelect('logistics')}
            className={`cursor-pointer group relative overflow-hidden rounded-2xl transition-all duration-500 border ${activeCategory === 'logistics' ? 'border-[#a9ddd3]/50 bg-[#a9ddd3]/[0.03] shadow-[0_0_40px_rgba(169,221,211,0.15)] shadow-inner' : 'border-white/[0.05] hover:border-white/[0.15] bg-black/20 hover:bg-black/40'} backdrop-blur-3xl h-32 md:h-48 flex flex-col items-center justify-center`}
          >
            <div className={`font-bold text-sm md:text-base tracking-widest uppercase transition-colors ${activeCategory === 'logistics' ? 'text-[#a9ddd3]' : 'text-[#e8e3d5]/70 group-hover:text-[#e8e3d5]'}`}>Logistics</div>
            <div className={`text-[9px] md:text-[10px] font-semibold tracking-widest uppercase mt-2 transition-colors ${activeCategory === 'logistics' ? 'text-[#a9ddd3]/70' : 'text-[#e8e3d5]/30'}`}>Automated SLAs</div>
          </div>

        </div>

        {/* Global CTA Button for Mobile */}
        <button 
          onClick={() => handleSelect(activeCategory)}
          className="px-8 md:px-10 py-4 bg-[#a9ddd3] text-[#040507] hover:bg-white font-bold tracking-widest uppercase text-[10px] md:text-xs rounded-lg transition-all shadow-[0_0_20px_rgba(169,221,211,0.3)] animate-fade-up delay-200"
        >
          {authenticated ? `Initialize ${activeCategory} Policy` : `Get ${activeCategory} Coverage`}
        </button>

      </main>
      
      <div className="pb-12 md:pb-24"></div>

      <footer className="relative z-10 w-full p-6 text-center text-[#e8e3d5]/30 text-[9px] md:text-[10px] tracking-widest uppercase font-mono animate-fade-up delay-300">
        <div className="flex flex-col md:flex-row justify-center items-center gap-4 md:gap-8 mb-4">
          <a href="#" className="hover:text-[#a9ddd3] transition-colors">Docs</a>
          <a href="#" className="hover:text-[#a9ddd3] transition-colors">X (Twitter)</a>
          <a href="#" className="hover:text-[#a9ddd3] transition-colors">Rialo Network</a>
        </div>
        <div>© 2026 Arca Protocol. All Rights Reserved.</div>
      </footer>
    </div>
  );
}

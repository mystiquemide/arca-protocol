import { useState } from 'react';
import { useAuth } from '../AuthContext';

export default function PrivyMockModal() {
  const { isModalOpen, setIsModalOpen, login } = useAuth();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email'); // 'email' or 'otp'
  const [otp, setOtp] = useState(['', '', '', '', '', '']);

  if (!isModalOpen) return null;

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (email) setStep('otp');
  };

  const handleOtpChange = (index, value) => {
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1); // only keep last char
    setOtp(newOtp);
    
    // Auto focus next input logic can go here, but keeping it simple for the mock
    
    // Auto submit if full
    if (index === 5 && value && newOtp.every(v => v !== '')) {
      setTimeout(() => login(email), 600);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#040507]/80 backdrop-blur-sm animate-fade-up" style={{ animationDuration: '0.2s' }}>
      <div className="bg-[#111318] border border-white/10 rounded-2xl w-full max-w-sm p-6 relative shadow-2xl flex flex-col items-center text-center mx-4">
        <button 
          onClick={() => { setIsModalOpen(false); setStep('email'); }}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>

        <div className="w-10 h-10 border-[1.5px] border-[#a9ddd3] rotate-45 flex items-center justify-center mb-6 mt-2 shadow-[0_0_15px_rgba(169,221,211,0.2)]">
          <div className="w-2 h-2 bg-[#e8e3d5] rounded-full"></div>
        </div>

        {step === 'email' ? (
          <>
            <h2 className="text-[#e8e3d5] text-lg font-bold mb-1">Log in or sign up</h2>
            <p className="text-[#e8e3d5]/50 text-[11px] mb-6 font-medium">Enter your email to continue</p>
            
            <form onSubmit={handleEmailSubmit} className="w-full">
              <input 
                type="email" 
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1A1C23] border border-white/5 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-[#a9ddd3]/50 transition-colors mb-4 placeholder-white/20"
                required
              />
              <button type="submit" className="w-full bg-[#e8e3d5] hover:bg-white text-[#040507] font-bold tracking-wide text-sm rounded-xl py-3.5 transition-colors">
                Continue with email
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-[#e8e3d5] text-lg font-bold mb-1">Check your email</h2>
            <p className="text-[#e8e3d5]/50 text-[11px] mb-6 font-medium">We sent a verification code to {email}</p>
            
            <div className="flex gap-2 justify-center w-full mb-4">
              {otp.map((digit, i) => (
                <input 
                  key={i}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  className="w-10 h-12 bg-[#1A1C23] border border-white/5 rounded-lg text-center text-lg text-white font-mono focus:outline-none focus:border-[#a9ddd3]/50 transition-colors"
                />
              ))}
            </div>
            <p className="text-[10px] text-[#e8e3d5]/30">Enter any 6 digits to mock login.</p>
          </>
        )}
        
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#e8e3d5]/20 mt-8">Protected by Privy</p>
      </div>
    </div>
  );
}

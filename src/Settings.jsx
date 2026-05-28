import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const { user } = usePrivy();
  const navigate = useNavigate();
  const appWalletAddress = user?.wallet?.address || '';
  const shortAddress = (address) => address ? `${address.slice(0, 8)}...${address.slice(-6)}` : 'Not available';

  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem('user_profile');
    return saved ? JSON.parse(saved) : { name: '', phone: '', country: '' };
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const handleSaveProfile = (e) => {
    e.preventDefault();
    localStorage.setItem('user_profile', JSON.stringify(profile));
    setIsEditingProfile(false);
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden flex flex-col pt-32 pb-12 items-center bg-[#040507]">
      <div className="z-10 w-full max-w-xl px-6 animate-fade-up relative">
        <button onClick={() => navigate(-1)} className="absolute top-0 left-6 -mt-12 flex items-center gap-2 text-[#e8e3d5]/50 hover:text-[#a9ddd3] text-[10px] font-bold tracking-widest uppercase transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          Return
        </button>
        <h1 className="text-2xl font-semibold text-[#e8e3d5] mb-8">Account</h1>

        <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 overflow-hidden mb-8 shadow-lg">
          <div className="p-6 border-b border-[#e8e3d5]/10 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-medium text-[#e8e3d5]/60 mb-1">Personal details</h2>
              <p className="text-xs text-[#e8e3d5]/40">The information Arca uses for account checks.</p>
            </div>
            {!isEditingProfile && (
              <button onClick={() => setIsEditingProfile(true)} className="text-xs font-medium text-[#a9ddd3] hover:text-white transition-colors">Edit</button>
            )}
          </div>

          <div className="p-6">
            {isEditingProfile ? (
              <form onSubmit={handleSaveProfile} className="space-y-4 animate-fade-up">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Full Legal Name</label>
                  <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" placeholder="e.g. Satoshi Nakamoto" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Phone Number</label>
                    <input type="text" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" placeholder="+1 234 567 8900" />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[#e8e3d5]/40 mb-1 block">Country of Residence</label>
                    <input type="text" value={profile.country} onChange={e => setProfile({ ...profile, country: e.target.value })} className="w-full bg-[#040507]/60 border border-[#e8e3d5]/10 rounded-md p-2.5 text-[#e8e3d5] text-sm focus:outline-none focus:border-[#a9ddd3]" placeholder="e.g. United Kingdom" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setIsEditingProfile(false)} className="flex-1 py-2.5 border border-[#e8e3d5]/10 hover:bg-white/5 text-[#e8e3d5]/60 text-xs font-bold uppercase tracking-widest rounded-md transition-all">Cancel</button>
                  <button type="submit" className="flex-1 py-2.5 bg-[#a9ddd3] hover:bg-white text-[#040507] text-xs font-bold uppercase tracking-widest rounded-md transition-all">Save Profile</button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-medium text-[#e8e3d5]">Full Legal Name</div>
                    <div className="text-xs text-[#e8e3d5]/50 mt-1">{profile.name || 'Not Provided'}</div>
                  </div>
                  {profile.name && <div className="text-xs font-medium text-[#a9ddd3] bg-[#a9ddd3]/10 px-3 py-1 rounded-full border border-[#a9ddd3]/20">KYC Level 1</div>}
                </div>
                <div className="h-[1px] w-full bg-[#e8e3d5]/5"></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-[#e8e3d5]">Phone Number</div>
                    <div className="text-xs text-[#e8e3d5]/50 mt-1">{profile.phone || 'Not Provided'}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#e8e3d5]">Country</div>
                    <div className="text-xs text-[#e8e3d5]/50 mt-1">{profile.country || 'Not Provided'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-[#e8e3d5]/5 rounded-2xl border border-[#e8e3d5]/10 overflow-hidden mb-8 shadow-lg">
          <div className="p-6 border-b border-[#e8e3d5]/10">
            <h2 className="text-sm font-medium text-[#e8e3d5]/60 mb-1">Arca account</h2>
            <p className="text-xs text-[#e8e3d5]/40">Your signed-in profile and built-in payout account status.</p>
          </div>
          <div className="p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm font-medium text-[#e8e3d5]">Email address</div>
                <div className="text-xs text-[#e8e3d5]/50 mt-1">{user?.email?.address || 'user@example.com'}</div>
              </div>
              <div className="text-xs font-medium text-[#a9ddd3] bg-[#a9ddd3]/10 px-3 py-1 rounded-full border border-[#a9ddd3]/20">Verified</div>
            </div>
            <div className="h-[1px] w-full bg-[#e8e3d5]/5"></div>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm font-medium text-[#e8e3d5]">Default payout account</div>
                <div className="text-xs text-[#e8e3d5]/50 mt-1 font-mono">{shortAddress(appWalletAddress)}</div>
              </div>
              <div className="text-xs font-medium text-[#e8e3d5]/40">{appWalletAddress ? 'Internal testing' : 'Coming soon'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

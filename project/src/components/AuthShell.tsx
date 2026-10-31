import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ShieldCheck, ArrowLeft, Check, CarFront } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex font-sans bg-white">
      {/* Premium Left Side - Hidden on small screens */}
      <div className="hidden lg:flex lg:w-[45%] bg-[#184f9a] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#123e7a] to-[#184f9a] z-0" />
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent z-0" />
        
        <div className="relative z-10 flex items-center">
          <img src="/logo.jpg" alt="MatMove" className="h-16 w-auto bg-white p-2 rounded-xl shadow-lg" />
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-extrabold mb-6 leading-tight">Move with confidence across Sierra Leone.</h2>
          <p className="text-blue-100 text-lg mb-10 leading-relaxed">Join thousands of riders, drivers, and merchants building the future of transportation.</p>
          <div className="space-y-5">
            <div className="flex items-center gap-4 text-blue-50"><ShieldCheck className="text-[#32a84a]" size={24} /> <span className="text-lg">Secure identity verification</span></div>
            <div className="flex items-center gap-4 text-blue-50"><ShieldCheck className="text-[#32a84a]" size={24} /> <span className="text-lg">Fast, reliable booking</span></div>
            <div className="flex items-center gap-4 text-blue-50"><ShieldCheck className="text-[#32a84a]" size={24} /> <span className="text-lg">Transparent pricing & payments</span></div>
          </div>
        </div>
        <div className="relative z-10 text-sm text-blue-200/60 font-medium">© 2026 MatMove. All rights reserved.</div>
      </div>

      {/* Right Side - Form Container */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-24 relative bg-slate-50">
        {/* Mobile Logo */}
        <div className="lg:hidden absolute top-6 left-6">
           <img src="/logo.jpg" alt="MatMove" className="h-12 w-auto mix-blend-multiply" />
        </div>
        <div className="max-w-md w-full mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-8 font-medium transition-colors" onClick={onClick}>
      <ArrowLeft size={18} /> {label}
    </button>
  );
}

export function AuthFormCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-3">{title}</h1>
      <p className="text-slate-500 mb-8 text-lg">{subtitle}</p>
      {/* We inject generic form styles here so AuthPages.tsx inputs look premium without changing that file */}
      <div className="[&_form]:space-y-5 [&_label>span]:block [&_label>span]:text-sm [&_label>span]:font-semibold [&_label>span]:text-slate-700 [&_label>span]:mb-1.5 [&_input]:w-full [&_input]:px-4 [&_input]:py-3 [&_input]:bg-white [&_input]:border [&_input]:border-slate-200 [&_input]:rounded-xl [&_input]:shadow-sm focus-within:[&_input]:border-[#184f9a] focus-within:[&_input]:ring-1 focus-within:[&_input]:ring-[#184f9a] [&_.input-field]:relative [&_.input-field>svg]:absolute [&_.input-field>svg]:left-4 [&_.input-field>svg]:top-3.5 [&_.input-field>svg]:text-slate-400 [&_input]:pl-11 [&_.primary-button]:w-full [&_.primary-button]:bg-[#184f9a] [&_.primary-button]:text-white [&_.primary-button]:py-3.5 [&_.primary-button]:rounded-xl [&_.primary-button]:font-semibold [&_.primary-button]:mt-4 hover:[&_.primary-button]:bg-[#123e7a] transition-all">
        {children}
      </div>
    </div>
  );
}

const stepLabels = ['Account', 'Role', 'Personal', 'Identity', 'Documents', 'Selfie', 'Review'];

export function OnboardingStepper({ current }: { current: number }) {
  return (
    <div className="flex justify-between items-center mb-8 relative">
      <div className="absolute left-0 top-4 w-full h-[2px] bg-slate-200 -z-10" />
      <div className="absolute left-0 top-4 h-[2px] bg-[#32a84a] -z-10 transition-all duration-500" style={{ width: `${((current - 1) / (stepLabels.length - 1)) * 100}%` }} />
      {stepLabels.map((label, index) => (
        <div key={label} className="flex flex-col items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${index + 1 < current ? 'bg-[#32a84a] text-white' : index + 1 === current ? 'bg-[#184f9a] text-white ring-4 ring-blue-100' : 'bg-white border-2 border-slate-200 text-slate-400'}`}>
            {index + 1 < current ? <Check size={16} /> : index + 1}
          </div>
          <span className={`text-xs font-medium hidden md:block ${index + 1 <= current ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function OnboardingShell({ step, children }: { step: number; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex font-sans bg-slate-50">
      <div className="hidden lg:flex lg:w-[35%] bg-slate-900 text-white p-12 flex-col justify-between border-r border-slate-800">
        <div>
          <div className="cursor-pointer mb-12 inline-block bg-white p-2 rounded-xl" onClick={() => navigate('/')}>
            <img src="/logo.jpg" alt="MatMove" className="h-10 w-auto" />
          </div>
          <h2 className="text-3xl font-bold mb-4">Let's get your account verified.</h2>
          <p className="text-slate-400 mb-8 leading-relaxed">MatMove takes identity seriously. We verify every member to keep our community safe and trusted.</p>
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-slate-300"><ShieldCheck className="text-[#32a84a]" /> <span>Your data is encrypted end-to-end</span></div>
            <div className="flex items-center gap-3 text-slate-300"><ShieldCheck className="text-[#32a84a]" /> <span>Documents are never shared publicly</span></div>
            <div className="flex items-center gap-3 text-slate-300"><ShieldCheck className="text-[#32a84a]" /> <span>Verification usually takes 24–48 hours</span></div>
          </div>
        </div>
        <div className="text-sm text-slate-600">© 2026 MatMove. All rights reserved.</div>
      </div>
      <div className="flex-1 flex flex-col py-10 px-6 lg:px-20 overflow-y-auto max-h-screen">
        <div className="max-w-3xl w-full mx-auto">
          <div className="flex items-center justify-between mb-8 lg:hidden">
            <img src="/logo.jpg" alt="MatMove" className="h-10 w-auto mix-blend-multiply" />
            <span className="text-sm font-semibold text-slate-500">Step {step} of 7</span>
          </div>
          <OnboardingStepper current={step} />
          <div className="bg-white p-8 lg:p-10 rounded-3xl shadow-sm border border-slate-100">
            {/* Inject generic onboarding styles */}
            <div className="[&_.ob-title]:text-3xl [&_.ob-title]:font-bold [&_.ob-title]:text-slate-900 [&_.ob-title]:mb-2 [&_.ob-subtitle]:text-slate-500 [&_.ob-subtitle]:mb-8 [&_.ob-form-grid]:grid [&_.ob-form-grid]:grid-cols-1 [&_.ob-form-grid]:md:grid-cols-2 [&_.ob-form-grid]:gap-6 [&_.field-full]:md:col-span-2 [&_.ob-actions]:flex [&_.ob-actions]:justify-between [&_.ob-actions]:mt-10 [&_.ob-actions]:pt-6 [&_.ob-actions]:border-t [&_.ob-actions]:border-slate-100 [&_.primary-button]:bg-[#184f9a] [&_.primary-button]:text-white [&_.primary-button]:px-6 [&_.primary-button]:py-3 [&_.primary-button]:rounded-xl [&_.primary-button]:font-semibold [&_.primary-button]:flex [&_.primary-button]:items-center [&_.primary-button]:gap-2 hover:[&_.primary-button]:bg-[#123e7a] disabled:[&_.primary-button]:opacity-50 [&_.back-button]:flex [&_.back-button]:items-center [&_.back-button]:gap-2 [&_.back-button]:text-slate-500 [&_.back-button]:font-medium hover:[&_.back-button]:text-slate-900 [&_input]:w-full [&_input]:px-4 [&_input]:py-3 [&_input]:bg-slate-50 [&_input]:border [&_input]:border-slate-200 [&_input]:rounded-xl focus:[&_input]:border-[#184f9a] focus:[&_input]:ring-1 focus:[&_input]:ring-[#184f9a] [&_label>span]:block [&_label>span]:text-sm [&_label>span]:font-semibold [&_label>span]:text-slate-700 [&_label>span]:mb-1.5 [&_select]:w-full [&_select]:px-4 [&_select]:py-3 [&_select]:bg-slate-50 [&_select]:border [&_select]:border-slate-200 [&_select]:rounded-xl">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
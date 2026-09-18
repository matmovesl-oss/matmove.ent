import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { PortalApp } from '@/pages/PortalApp';
import { LoginPage, SignupPage } from '@/pages/AuthPages';
import { LandingPage } from '@/pages/LandingPage';
import {
  RoleSelectionPage,
  PersonalInfoPage,
  IdentityPage,
  DocumentsPage,
  SelfiePage,
  VehicleSelectionPage,
  ReviewPage,
  SubmittedPage,
  VerificationPage,
} from '@/pages/OnboardingPages';
import { ForgotPasswordPage } from '@/pages/PasswordPages';
import { UpdatePassword } from '@/pages/UpdatePassword';

function CustomerPortal() {
  const { session, loading } = useAuth();

  // 1. Wait for Supabase to finish checking the session BEFORE panicking
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 2. If it finishes loading and there truly is no session, then kick to login
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // 3. Otherwise, enter the Portal and let the Smart PIN Tracker do its job!
  return <PortalApp />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* SECURE PASSWORD ROUTES */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      {/* This MUST match the path you configure in Supabase Email Templates */}
      <Route path="/reset-password" element={<UpdatePassword />} /> 

      {/* ONBOARDING ROUTES */}
      <Route path="/select-role" element={<RoleSelectionPage />} />
      <Route path="/onboarding/personal" element={<PersonalInfoPage />} />
      <Route path="/onboarding/identity" element={<IdentityPage />} />
      <Route path="/onboarding/documents" element={<DocumentsPage />} />
      <Route path="/onboarding/selfie" element={<SelfiePage />} />
      <Route path="/onboarding/vehicle" element={<VehicleSelectionPage />} />
      <Route path="/onboarding/review" element={<ReviewPage />} />
      <Route path="/onboarding/submitted" element={<SubmittedPage />} />
      <Route path="/verification" element={<VerificationPage />} />

      {/* CUSTOMER PORTAL */}
      <Route path="/customer/*" element={<CustomerPortal />} />
      <Route path="/customer/rider/*" element={<CustomerPortal />} />
      <Route path="/customer/driver/*" element={<CustomerPortal />} />
      <Route path="/customer/merchant/*" element={<CustomerPortal />} />

      {/* FALLBACK */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
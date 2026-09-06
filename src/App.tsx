import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { PortalApp } from '@/pages/PortalApp';
import { LoginPage, SignupPage } from '@/pages/AuthPages';
import { LandingPage } from '@/pages/LandingPage';
import {
  RoleSelectionPage, PersonalInfoPage, IdentityPage, DocumentsPage,
  SelfiePage, VehicleSelectionPage, ReviewPage, SubmittedPage, VerificationPage,
} from '@/pages/OnboardingPages';
// NEW: Import the password pages
import { ForgotPasswordPage, UpdatePasswordPage } from '@/pages/PasswordPages';

export default function App() {
  const { session } = useAuth();

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      
      {/* Password Reset Routes */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<UpdatePasswordPage />} />

      {/* Onboarding Routes */}
      <Route path="/select-role" element={<RoleSelectionPage />} />
      <Route path="/onboarding/personal" element={<PersonalInfoPage />} />
      <Route path="/onboarding/identity" element={<IdentityPage />} />
      <Route path="/onboarding/documents" element={<DocumentsPage />} />
      <Route path="/onboarding/selfie" element={<SelfiePage />} />
      <Route path="/onboarding/vehicle" element={<VehicleSelectionPage />} />
      <Route path="/onboarding/review" element={<ReviewPage />} />
      <Route path="/onboarding/submitted" element={<SubmittedPage />} />
      <Route path="/verification" element={<VerificationPage />} />

      {/* Protected Portal Route */}
      <Route
        path="/customer/*"
        element={session ? <PortalApp /> : <Navigate to="/login" replace />}
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
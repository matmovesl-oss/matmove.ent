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
import {
  ForgotPasswordPage,
  UpdatePasswordPage,
} from '@/pages/PasswordPages';

function CustomerPortal() {
  const { session } = useAuth();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <PortalApp />;
}

export default function App() {
  return (
    <Routes>
      {/* =========================================================
          PUBLIC ROUTES
      ========================================================= */}
      <Route path="/" element={<LandingPage />} />

      <Route path="/login" element={<LoginPage />} />

      <Route path="/signup" element={<SignupPage />} />

      {/* =========================================================
          PASSWORD ROUTES
      ========================================================= */}
      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/reset-password"
        element={<UpdatePasswordPage />}
      />

      {/* =========================================================
          ONBOARDING ROUTES
      ========================================================= */}
      <Route
        path="/select-role"
        element={<RoleSelectionPage />}
      />

      <Route
        path="/onboarding/personal"
        element={<PersonalInfoPage />}
      />

      <Route
        path="/onboarding/identity"
        element={<IdentityPage />}
      />

      <Route
        path="/onboarding/documents"
        element={<DocumentsPage />}
      />

      <Route
        path="/onboarding/selfie"
        element={<SelfiePage />}
      />

      <Route
        path="/onboarding/vehicle"
        element={<VehicleSelectionPage />}
      />

      <Route
        path="/onboarding/review"
        element={<ReviewPage />}
      />

      <Route
        path="/onboarding/submitted"
        element={<SubmittedPage />}
      />

      <Route
        path="/verification"
        element={<VerificationPage />}
      />

      {/* =========================================================
          CUSTOMER PORTAL
          
          All three customer roles currently enter through the
          same protected portal. PortalApp is responsible for
          displaying the correct role experience.
      ========================================================= */}
      <Route
        path="/customer/*"
        element={<CustomerPortal />}
      />

      {/* Explicit role entry points.
          These make the routing structure ready for the
          dedicated Rider / Driver / Merchant experiences. */}
      <Route
        path="/customer/rider/*"
        element={<CustomerPortal />}
      />

      <Route
        path="/customer/driver/*"
        element={<CustomerPortal />}
      />

      <Route
        path="/customer/merchant/*"
        element={<CustomerPortal />}
      />

      {/* =========================================================
          FALLBACK
      ========================================================= */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}
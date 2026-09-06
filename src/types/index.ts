export type UserRole = 'rider' | 'driver' | 'merchant';

export type KycStatus =
  | 'not_started'
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'resubmission_required';

export type DocumentType =
  | 'identity_front'
  | 'identity_back'
  | 'drivers_license_front'
  | 'drivers_license_back'
  | 'business_document'
  | 'selfie';

export interface UploadedDocument {
  type: DocumentType;
  fileName: string;
  fileSize: number;
  uploadProgress: number;
  status: 'uploading' | 'uploaded' | 'error';
  previewUrl?: string;
}

export interface PersonalInfo {
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  nationality: string;
  country: string;
  residentialAddress: string;
  city: string;
}

export interface IdentityInfo {
  idType: string;
  idNumber: string;
  idIssuingCountry: string;
  idExpiryDate: string;
}

export interface DriverInfo {
  licenseNumber: string;
  licenseClass: string;
  issueDate: string;
  expiryDate: string;
}

export interface MerchantInfo {
  businessName: string;
  businessType: string;
  businessRegNumber: string;
  businessAddress: string;
  authRepName: string;
  authRepPhone: string;
}

export interface KycSubmission {
  role: UserRole;
  personalInfo: Partial<PersonalInfo>;
  identityInfo: Partial<IdentityInfo>;
  driverInfo?: Partial<DriverInfo>;
  merchantInfo?: Partial<MerchantInfo>;
  documents: UploadedDocument[];
  status: KycStatus;
  submittedAt?: string;
  rejectionReason?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
}

export interface AuthSession {
  user: AuthUser;
  roles: UserRole[];
  kycStatus: KycStatus;
}

export interface Wallet {
  balance: number;
  currency: string;
}

export interface Transaction {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: number;
  direction: 'in' | 'out';
  status: 'Completed' | 'Pending' | 'Failed';
}

import type { KycSubmission, KycStatus, UserRole, DocumentType } from '@/types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let mockSubmission: KycSubmission | null = null;

export async function createKycSubmission(role: UserRole): Promise<KycSubmission> {
  await delay(400);
  mockSubmission = {
    role,
    personalInfo: {},
    identityInfo: {},
    driverInfo: role === 'driver' ? {} : undefined,
    merchantInfo: role === 'merchant' ? {} : undefined,
    documents: [],
    status: 'draft',
  };
  return mockSubmission;
}

export async function updateKycSubmission(
  data: Partial<KycSubmission>
): Promise<KycSubmission> {
  await delay(300);
  mockSubmission = { ...mockSubmission, ...data } as KycSubmission;
  return mockSubmission!;
}

export async function submitKyc(): Promise<KycSubmission> {
  await delay(1200);
  mockSubmission = {
    ...mockSubmission!,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  };
  return mockSubmission;
}

export async function getKycStatus(_userId: string): Promise<KycStatus> {
  await delay(300);
  return mockSubmission?.status ?? 'not_started';
}

export async function getKycSubmission(): Promise<KycSubmission | null> {
  await delay(200);
  return mockSubmission;
}

export async function resubmitKyc(): Promise<KycSubmission> {
  await delay(500);
  mockSubmission = {
    ...mockSubmission!,
    status: 'draft',
    rejectionReason: undefined,
  };
  return mockSubmission;
}

export function getRequiredDocuments(role: UserRole): DocumentType[] {
  if (role === 'rider') return ['identity_front', 'identity_back', 'selfie'];
  if (role === 'driver')
    return ['drivers_license_front', 'drivers_license_back', 'selfie'];
  return ['business_document', 'identity_front', 'identity_back', 'selfie'];
}

export function getDocumentLabel(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    identity_front: 'ID — Front',
    identity_back: 'ID — Back',
    drivers_license_front: "Driver's License — Front",
    drivers_license_back: "Driver's License — Back",
    business_document: 'Business Registration Document',
    selfie: 'Selfie / Selfie Verification',
  };
  return labels[type];
}
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  CarFront,
  Truck,
  Store,
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  FileText,
  AlertCircle,
  UploadCloud,
  Camera,
} from 'lucide-react';
import { OnboardingShell } from '@/components/AuthShell';
import {
  DocumentUpload,
  SelfieUpload,
} from '@/components/DocumentUpload';
import { useAuth } from '@/context/AuthContext';
import {
  roleLabels,
  roleDescriptions,
} from '@/services/roleService';
import type {
  UserRole,
  PersonalInfo,
  IdentityInfo,
  DriverInfo,
  MerchantInfo,
  UploadedDocument,
  DocumentType,
} from '@/types';

type OnboardingPersonalInfo =
  Partial<PersonalInfo> & {
    phone?: string;
  };

function useOnboardingState<T>(
  key: string,
  initialValue: T
) {
  const [state, setState] = useState<T>(() => {
    const stored = sessionStorage.getItem(key);

    if (!stored) {
      return initialValue;
    }

    try {
      return JSON.parse(stored) as T;
    } catch {
      sessionStorage.removeItem(key);
      return initialValue;
    }
  });

  const setPersistentState = (value: T) => {
    setState(value);
    sessionStorage.setItem(
      key,
      JSON.stringify(value)
    );
  };

  return [
    state,
    setPersistentState,
  ] as const;
}

function getActiveRole(): UserRole {
  const storedRole =
    sessionStorage.getItem('ob_role');

  if (
    storedRole === 'rider' ||
    storedRole === 'driver' ||
    storedRole === 'merchant'
  ) {
    return storedRole;
  }

  return 'rider';
}

function normalizePhone(value: string): string {
  return value
    .trim()
    .replace(/[^\d+]/g, '');
}

export function RoleSelectionPage() {
  const { setRoles } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] =
    useState<UserRole | null>(null);

  const [isProcessing, setIsProcessing] =
    useState(false);

  const roles: {
    key: UserRole;
    icon: React.ReactNode;
    tone: string;
  }[] = [
    {
      key: 'rider',
      icon: <CarFront size={26} />,
      tone: 'blue',
    },
    {
      key: 'driver',
      icon: <Truck size={26} />,
      tone: 'green',
    },
    {
      key: 'merchant',
      icon: <Store size={26} />,
      tone: 'orange',
    },
  ];

  const handleContinue = async () => {
    if (!selected) {
      return;
    }

    setIsProcessing(true);

    try {
      sessionStorage.setItem(
        'ob_role',
        selected
      );

      await setRoles([selected]);

      navigate('/onboarding/personal');
    } catch (error) {
      console.error(
        'Role selection error:',
        error
      );

      alert(
        'Failed to save your account type. Please check your internet connection and try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <OnboardingShell step={2}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          How will you use MatMove?
        </h2>

        <p className="ob-subtitle">
          Choose your primary account type.
          You can add more roles later.
        </p>

        <div className="role-choice-grid">
          {roles.map(
            ({
              key,
              icon,
              tone,
            }) => (
              <button
                key={key}
                type="button"
                className={`role-choice-card ${
                  selected === key
                    ? 'selected'
                    : ''
                }`}
                onClick={() =>
                  setSelected(key)
                }
              >
                <div
                  className={`icon-box tone-${tone} icon-lg`}
                >
                  {icon}
                </div>

                <strong>
                  {roleLabels[key]}
                </strong>

                <span>
                  {roleDescriptions[key]}
                </span>

                {selected === key && (
                  <div className="selected-check">
                    <Check size={13} />
                  </div>
                )}
              </button>
            )
          )}
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/')}
            disabled={isProcessing}
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={
              !selected ||
              isProcessing
            }
            onClick={
              handleContinue
            }
          >
            {isProcessing
              ? 'Saving...'
              : 'Continue'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function PersonalInfoPage() {
  const navigate = useNavigate();

  const [
    info,
    setInfo,
  ] =
    useOnboardingState<OnboardingPersonalInfo>(
      'ob_personal',
      {
        firstName: '',
        middleName: '',
        lastName: '',
        phone: '',
        dateOfBirth: '',
        nationality:
          'Sierra Leonean',
        country:
          'Sierra Leone',
        residentialAddress: '',
        city: '',
      }
    );

  const update = (
    field: keyof OnboardingPersonalInfo,
    value: string
  ) => {
    setInfo({
      ...info,
      [field]: value,
    });
  };

  const normalizedPhone =
    normalizePhone(
      info.phone ?? ''
    );

  const isValid =
    Boolean(
      info.firstName?.trim() &&
        info.lastName?.trim() &&
        normalizedPhone &&
        info.dateOfBirth &&
        info.residentialAddress?.trim() &&
        info.city?.trim()
    );

  return (
    <OnboardingShell step={3}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          Personal information
        </h2>

        <p className="ob-subtitle">
          Tell us about yourself. This
          information is kept private and
          secure.
        </p>

        <div className="ob-form-grid">
          <Field label="First name">
            <input
              className="ob-input"
              value={
                info.firstName ?? ''
              }
              onChange={(e) =>
                update(
                  'firstName',
                  e.target.value
                )
              }
              placeholder="Aisha"
              autoComplete="given-name"
            />
          </Field>

          <Field label="Middle name">
            <input
              className="ob-input"
              value={
                info.middleName ?? ''
              }
              onChange={(e) =>
                update(
                  'middleName',
                  e.target.value
                )
              }
              placeholder="Mariama"
              autoComplete="additional-name"
            />
          </Field>

          <Field label="Last name">
            <input
              className="ob-input"
              value={
                info.lastName ?? ''
              }
              onChange={(e) =>
                update(
                  'lastName',
                  e.target.value
                )
              }
              placeholder="Kamara"
              autoComplete="family-name"
            />
          </Field>

          <Field label="Phone number">
            <input
              className="ob-input"
              value={
                info.phone ?? ''
              }
              onChange={(e) =>
                update(
                  'phone',
                  e.target.value
                )
              }
              placeholder="+232 76 123 456"
              inputMode="tel"
              autoComplete="tel"
              required
            />

            <small className="block mt-1 text-xs text-slate-500">
              Use the phone number you will
              use for MatMove payments,
              withdrawals and account
              verification.
            </small>
          </Field>

          <Field label="Date of birth">
            <input
              className="ob-input"
              type="date"
              value={
                info.dateOfBirth ?? ''
              }
              onChange={(e) =>
                update(
                  'dateOfBirth',
                  e.target.value
                )
              }
            />
          </Field>

          <Field label="Nationality">
            <input
              className="ob-input"
              value={
                info.nationality ?? ''
              }
              onChange={(e) =>
                update(
                  'nationality',
                  e.target.value
                )
              }
            />
          </Field>

          <Field label="Country">
            <input
              className="ob-input"
              value={
                info.country ?? ''
              }
              onChange={(e) =>
                update(
                  'country',
                  e.target.value
                )
              }
            />
          </Field>

          <Field
            label="Residential address"
            full
          >
            <input
              className="ob-input"
              value={
                info.residentialAddress ??
                ''
              }
              onChange={(e) =>
                update(
                  'residentialAddress',
                  e.target.value
                )
              }
              placeholder="123 Lumley Beach Road"
              autoComplete="street-address"
            />
          </Field>

          <Field label="City">
            <input
              className="ob-input"
              value={
                info.city ?? ''
              }
              onChange={(e) =>
                update(
                  'city',
                  e.target.value
                )
              }
              placeholder="Freetown"
              autoComplete="address-level2"
            />
          </Field>
        </div>

        <div className="mt-8 p-4 bg-slate-50 rounded-xl flex items-start gap-3 text-sm text-slate-600 border border-slate-200">
          <ShieldCheck
            className="text-[#32a84a] shrink-0"
            size={20}
          />

          <span>
            Your personal information is
            encrypted and securely stored.
            Your phone number is used to
            identify your MatMove account
            and support verified financial
            transactions.
          </span>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate('/select-role')
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!isValid}
            onClick={() => {
              setInfo({
                ...info,
                phone:
                  normalizedPhone,
              });

              navigate(
                '/onboarding/identity'
              );
            }}
          >
            Continue
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function IdentityPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [
    identity,
    setIdentity,
  ] =
    useOnboardingState<
      Partial<IdentityInfo>
    >(
      'ob_identity',
      {
        idType: '',
        idNumber: '',
        idIssuingCountry:
          'Sierra Leone',
        idExpiryDate: '',
      }
    );

  const [
    driver,
    setDriver,
  ] =
    useOnboardingState<
      Partial<DriverInfo>
    >(
      'ob_driver',
      {
        licenseNumber: '',
        licenseClass: '',
        issueDate: '',
        expiryDate: '',
      }
    );

  const [
    merchant,
    setMerchant,
  ] =
    useOnboardingState<
      Partial<MerchantInfo> & {
        infrastructure?: string;
      }
    >(
      'ob_merchant',
      {
        businessName: '',
        businessType: '',
        businessRegNumber: '',
        businessAddress: '',
        authRepName: '',
        authRepPhone: '',
        infrastructure:
          'Physical Shop / Location',
      }
    );

  const updateId = (
    field: keyof IdentityInfo,
    value: string
  ) => {
    setIdentity({
      ...identity,
      [field]: value,
    });
  };

  const updateDriver = (
    field: keyof DriverInfo,
    value: string
  ) => {
    setDriver({
      ...driver,
      [field]: value,
    });
  };

  const updateMerchant = (
    field: string,
    value: string
  ) => {
    setMerchant({
      ...merchant,
      [field]: value,
    });
  };

  const idTypes =
    role === 'driver'
      ? ["Driver's License"]
      : role === 'merchant'
        ? [
            'National ID',
            'Passport',
            'Business Registration',
          ]
        : [
            'National ID',
            'Passport',
          ];

  const currentIdType =
    identity.idType &&
    idTypes.includes(
      identity.idType
    )
      ? identity.idType
      : idTypes[0];

  const isDigitalMerchant =
    role === 'merchant' &&
    merchant.infrastructure ===
      'Digital / Online Only';

  const hideStandardIdFields =
    (role === 'driver' &&
      currentIdType ===
        "Driver's License") ||
    (role === 'merchant' &&
      currentIdType ===
        'Business Registration');

  useEffect(() => {
    if (
      identity.idType !==
      currentIdType
    ) {
      updateId(
        'idType',
        currentIdType
      );
    }
  }, [
    identity.idType,
    currentIdType,
  ]);

  return (
    <OnboardingShell step={4}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          {role === 'driver'
            ? 'Driver identity'
            : role === 'merchant'
              ? 'Business identity'
              : 'Identity verification'}
        </h2>

        <p className="ob-subtitle">
          {role === 'merchant'
            ? 'Provide your business and representative details.'
            : 'Provide your identity document details.'}
        </p>

        <div className="ob-form-grid">
          <Field label="ID type">
            <div className="ob-select-wrap">
              <select
                className="ob-input"
                value={
                  currentIdType
                }
                onChange={(e) =>
                  updateId(
                    'idType',
                    e.target.value
                  )
                }
              >
                {idTypes.map(
                  (type) => (
                    <option
                      key={type}
                    >
                      {type}
                    </option>
                  )
                )}
              </select>
            </div>
          </Field>

          {!hideStandardIdFields && (
            <>
              <Field label="ID number">
                <input
                  className="ob-input"
                  value={
                    identity.idNumber ??
                    ''
                  }
                  onChange={(e) =>
                    updateId(
                      'idNumber',
                      e.target.value
                    )
                  }
                  placeholder="Enter ID number"
                />
              </Field>

              <Field label="ID expiry date">
                <input
                  className="ob-input"
                  type="date"
                  value={
                    identity.idExpiryDate ??
                    ''
                  }
                  onChange={(e) =>
                    updateId(
                      'idExpiryDate',
                      e.target.value
                    )
                  }
                />
              </Field>
            </>
          )}

          <Field label="ID issuing country">
            <input
              className="ob-input"
              value={
                identity.idIssuingCountry ??
                ''
              }
              onChange={(e) =>
                updateId(
                  'idIssuingCountry',
                  e.target.value
                )
              }
            />
          </Field>
        </div>

        {role === 'driver' && (
          <>
            <div className="ob-section-divider mt-8 mb-6">
              <span className="text-lg font-bold text-slate-900 border-b-2 border-slate-200 pb-2">
                Driver's License Details
              </span>
            </div>

            <div className="ob-form-grid">
              <Field label="License number">
                <input
                  className="ob-input"
                  value={
                    driver.licenseNumber ??
                    ''
                  }
                  onChange={(e) =>
                    updateDriver(
                      'licenseNumber',
                      e.target.value
                    )
                  }
                />
              </Field>

              <Field label="License class / category">
                <input
                  className="ob-input"
                  value={
                    driver.licenseClass ??
                    ''
                  }
                  onChange={(e) =>
                    updateDriver(
                      'licenseClass',
                      e.target.value
                    )
                  }
                  placeholder="e.g. Class B"
                />
              </Field>

              <Field label="Issue date">
                <input
                  className="ob-input"
                  type="date"
                  value={
                    driver.issueDate ??
                    ''
                  }
                  onChange={(e) =>
                    updateDriver(
                      'issueDate',
                      e.target.value
                    )
                  }
                />
              </Field>

              <Field label="Expiry date">
                <input
                  className="ob-input"
                  type="date"
                  value={
                    driver.expiryDate ??
                    ''
                  }
                  onChange={(e) =>
                    updateDriver(
                      'expiryDate',
                      e.target.value
                    )
                  }
                />
              </Field>
            </div>
          </>
        )}

        {role === 'merchant' && (
          <>
            <div className="ob-section-divider mt-8 mb-6">
              <span className="text-lg font-bold text-slate-900 border-b-2 border-slate-200 pb-2">
                Business Details
              </span>
            </div>

            <div className="ob-form-grid">
              <Field label="Business name">
                <input
                  className="ob-input"
                  value={
                    merchant.businessName ??
                    ''
                  }
                  onChange={(e) =>
                    updateMerchant(
                      'businessName',
                      e.target.value
                    )
                  }
                />
              </Field>

              <Field label="Infrastructure">
                <div className="ob-select-wrap">
                  <select
                    className="ob-input"
                    value={
                      merchant.infrastructure ??
                      ''
                    }
                    onChange={(e) =>
                      updateMerchant(
                        'infrastructure',
                        e.target.value
                      )
                    }
                  >
                    <option>
                      Physical Shop / Location
                    </option>
                    <option>
                      Digital / Online Only
                    </option>
                  </select>
                </div>
              </Field>

              {!isDigitalMerchant && (
                <Field label="Business registration number">
                  <input
                    className="ob-input"
                    value={
                      merchant.businessRegNumber ??
                      ''
                    }
                    onChange={(e) =>
                      updateMerchant(
                        'businessRegNumber',
                        e.target.value
                      )
                    }
                  />
                </Field>
              )}

              <Field
                label="Business address"
                full
              >
                <input
                  className="ob-input"
                  value={
                    merchant.businessAddress ??
                    ''
                  }
                  onChange={(e) =>
                    updateMerchant(
                      'businessAddress',
                      e.target.value
                    )
                  }
                />
              </Field>

              <Field label="Authorized representative name">
                <input
                  className="ob-input"
                  value={
                    merchant.authRepName ??
                    ''
                  }
                  onChange={(e) =>
                    updateMerchant(
                      'authRepName',
                      e.target.value
                    )
                  }
                />
              </Field>

              <Field label="Authorized representative phone">
                <input
                  className="ob-input"
                  value={
                    merchant.authRepPhone ??
                    ''
                  }
                  onChange={(e) =>
                    updateMerchant(
                      'authRepPhone',
                      e.target.value
                    )
                  }
                  inputMode="tel"
                />
              </Field>
            </div>
          </>
        )}

        <div className="mt-8 p-4 bg-slate-50 rounded-xl flex items-start gap-3 text-sm text-slate-600 border border-slate-200">
          <ShieldCheck
            className="text-[#32a84a] shrink-0"
            size={20}
          />

          <span>
            Your identity information is
            encrypted and only used for
            verification purposes.
          </span>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(
                '/onboarding/personal'
              )
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={() =>
              navigate(
                '/onboarding/documents'
              )
            }
          >
            Continue
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function DocumentsPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [identity] =
    useOnboardingState<
      Partial<IdentityInfo>
    >(
      'ob_identity',
      {}
    );

  const [merchant] =
    useOnboardingState<
      Partial<MerchantInfo> & {
        infrastructure?: string;
      }
    >(
      'ob_merchant',
      {}
    );

  const currentIdType =
    identity.idType ||
    'National ID';

  const isDigitalMerchant =
    role === 'merchant' &&
    merchant.infrastructure ===
      'Digital / Online Only';

  let displayDocs: {
    id: DocumentType;
    label: string;
    required: boolean;
  }[] = [];

  if (role === 'driver') {
    displayDocs = [
      {
        id: 'id_front',
        label:
          "Driver's License (Front Only)",
        required: true,
      },
    ];
  } else if (
    role === 'merchant'
  ) {
    if (
      currentIdType ===
      'Business Registration'
    ) {
      if (!isDigitalMerchant) {
        displayDocs = [
          {
            id: 'id_front',
            label:
              'Business Document 1 (Required)',
            required: true,
          },
          {
            id: 'id_back',
            label:
              'Business Document 2 (Optional)',
            required: false,
          },
        ];
      }
    } else if (
      currentIdType ===
      'Passport'
    ) {
      displayDocs = [
        {
          id: 'id_front',
          label:
            'Passport (Front/Photo Page)',
          required: true,
        },
      ];
    } else {
      displayDocs = [
        {
          id: 'id_front',
          label:
            'National ID (Front)',
          required: true,
        },
        {
          id: 'id_back',
          label:
            'National ID (Back)',
          required: true,
        },
      ];
    }
  } else if (
    currentIdType ===
    'Passport'
  ) {
    displayDocs = [
      {
        id: 'id_front',
        label:
          'Passport (Front/Photo Page)',
        required: true,
      },
    ];
  } else {
    displayDocs = [
      {
        id: 'id_front',
        label:
          'National ID (Front)',
        required: true,
      },
      {
        id: 'id_back',
        label:
          'National ID (Back)',
        required: true,
      },
    ];
  }

  const [
    docs,
    setDocs,
  ] =
    useState<
      Record<
        DocumentType,
        UploadedDocument | undefined
      >
    >(
      {} as Record<
        DocumentType,
        UploadedDocument | undefined
      >
    );

  const handleUpload = (
    type: DocumentType,
    document: UploadedDocument
  ) => {
    setDocs({
      ...docs,
      [type]: document,
    });
  };

  const handleRemove = (
    type: DocumentType
  ) => {
    setDocs({
      ...docs,
      [type]: undefined,
    });
  };

  const allUploaded =
    displayDocs
      .filter(
        (document) =>
          document.required
      )
      .every(
        (document) =>
          docs[document.id]
            ?.status ===
          'uploaded'
      );

  useEffect(() => {
    if (
      displayDocs.length === 0
    ) {
      navigate(
        '/onboarding/selfie',
        {
          replace: true,
        }
      );
    }
  }, [
    displayDocs.length,
    navigate,
  ]);

  return (
    <OnboardingShell step={5}>
      <style>{`
        .premium-dropzones [data-doc-type] {
          border: 2px dashed #cbd5e1;
          border-radius: 1.25rem;
          padding: 2.5rem 2rem;
          text-align: center;
          background: #f8fafc;
          transition: all 0.2s ease-in-out;
          margin-bottom: 1.5rem;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .premium-dropzones [data-doc-type]:hover {
          border-color: #184f9a;
          background: #eff6ff;
        }

        .premium-dropzones .upload-icon {
          color: #184f9a;
          margin: 0 auto 1rem auto;
          background: white;
          padding: 0.75rem;
          border-radius: 50%;
          box-shadow:
            0 4px 6px -1px
            rgb(0 0 0 / 0.1);
        }
      `}</style>

      <div className="ob-page animate-in premium-dropzones">
        <h2 className="ob-title">
          Upload your documents
        </h2>

        <p className="ob-subtitle">
          Upload clear, legible copies of
          your {currentIdType}. We accept
          JPG, PNG, WebP, and PDF.
        </p>

        <div className="doc-upload-list grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {displayDocs.map(
            (docConfig) => (
              <div
                key={docConfig.id}
                className="flex flex-col"
              >
                <span className="mb-3 font-bold text-slate-700 ml-1">
                  {
                    docConfig.label
                  }
                </span>

                <div
                  data-doc-type={
                    docConfig.id
                  }
                  className="relative"
                >
                  {!docs[
                    docConfig.id
                  ] && (
                    <UploadCloud
                      className="upload-icon"
                      size={56}
                      strokeWidth={1.5}
                    />
                  )}

                  <DocumentUpload
                    type={
                      docConfig.id
                    }
                    document={
                      docs[
                        docConfig.id
                      ]
                    }
                    onUpload={(
                      document
                    ) =>
                      handleUpload(
                        docConfig.id,
                        document
                      )
                    }
                    onRemove={() =>
                      handleRemove(
                        docConfig.id
                      )
                    }
                  />

                  {!docs[
                    docConfig.id
                  ] && (
                    <>
                      <p className="text-sm text-slate-500 mt-3 font-medium">
                        Tap or drag to upload
                      </p>

                      <p className="text-xs text-slate-400 mt-1">
                        Max file size:
                        10MB
                      </p>
                    </>
                  )}
                </div>
              </div>
            )
          )}
        </div>

        <div className="mt-8 p-4 bg-slate-50 rounded-xl flex items-start gap-3 text-sm text-slate-600 border border-slate-200">
          <ShieldCheck
            className="text-[#32a84a] shrink-0"
            size={20}
          />

          <span>
            Documents are stored securely
            and never shared publicly.
          </span>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(
                '/onboarding/identity'
              )
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!allUploaded}
            onClick={() =>
              navigate(
                '/onboarding/selfie'
              )
            }
          >
            Continue
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SelfiePage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [
    selfie,
    setSelfie,
  ] =
    useState<
      UploadedDocument | undefined
    >(undefined);

  useEffect(() => {
    const stored =
      sessionStorage.getItem(
        'ob_selfie'
      );

    if (stored) {
      try {
        setSelfie(
          JSON.parse(
            stored
          ) as UploadedDocument
        );
      } catch {
        sessionStorage.removeItem(
          'ob_selfie'
        );
      }
    }
  }, []);

  const handleSelfieUpload = (
    document: UploadedDocument
  ) => {
    setSelfie(document);

    sessionStorage.setItem(
      'ob_selfie',
      JSON.stringify({
        id: document.id,
        type: document.type,
        fileName:
          document.fileName,
        fileSize:
          document.fileSize,
        status:
          document.status,
      })
    );
  };

  const handleSelfieRemove =
    () => {
      setSelfie(undefined);
      sessionStorage.removeItem(
        'ob_selfie'
      );
    };

  return (
    <OnboardingShell step={6}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          Selfie verification
        </h2>

        <p className="ob-subtitle">
          Take a clear selfie in good
          lighting. This helps us confirm
          your identity.
        </p>

        <div className="flex flex-col md:flex-row gap-8 items-start mt-8">
          <div className="flex-1 w-full bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200 text-center hover:border-[#184f9a] transition-colors relative">
            {!selfie && (
              <Camera
                className="mx-auto mb-4 text-[#184f9a] bg-white p-3 rounded-full shadow-md"
                size={64}
              />
            )}

            <SelfieUpload
              document={selfie}
              onUpload={
                handleSelfieUpload
              }
              onRemove={
                handleSelfieRemove
              }
            />
          </div>

          <div className="flex-1 w-full space-y-4 bg-[#eff6ff] p-6 rounded-2xl border border-blue-100">
            <h4 className="font-bold text-slate-900 mb-2">
              Selfie guidelines
            </h4>

            <Guideline text="Face the camera directly" />
            <Guideline text="Ensure good lighting" />
            <Guideline text="Remove sunglasses and hats" />
          </div>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(
                '/onboarding/documents'
              )
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!selfie}
            onClick={() =>
              navigate(
                role === 'driver'
                  ? '/onboarding/vehicle'
                  : '/onboarding/review'
              )
            }
          >
            Continue
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function VehicleSelectionPage() {
  const navigate = useNavigate();

  const [
    vehicle,
    setVehicle,
  ] =
    useOnboardingState<{
      type: string;
      plateNumber: string;
      region: string;
    }>(
      'ob_vehicle_details',
      {
        type: '',
        plateNumber: '',
        region:
          'West (Freetown)',
      }
    );

  const vehicles = [
    {
      name: 'Motorbike (Okada)',
      image: '/bike.jpg',
    },
    {
      name: 'Tricycle (Keke)',
      image: '/keke.jpg',
    },
    {
      name: 'Car',
      image: '/car.jpg',
    },
    {
      name: 'Van / Truck',
      image: '/van.jpg',
    },
  ];

  const isValid =
    Boolean(
      vehicle.type &&
        vehicle.plateNumber &&
        vehicle.region
    );

  return (
    <OnboardingShell
      step={6.5 as any}
    >
      <div className="ob-page animate-in">
        <h2 className="ob-title font-extrabold tracking-tight">
          Vehicle details
        </h2>

        <p className="ob-subtitle">
          Provide details about the vehicle
          you will be driving.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
          {vehicles.map(
            (vehicleOption) => (
              <button
                key={
                  vehicleOption.name
                }
                type="button"
                className={`p-6 rounded-3xl border-2 text-left flex flex-col items-center justify-center gap-4 transition-all duration-200 ${
                  vehicle.type ===
                  vehicleOption.name
                    ? 'border-[#184f9a] bg-[#eff6ff] shadow-md'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() =>
                  setVehicle({
                    ...vehicle,
                    type:
                      vehicleOption.name,
                  })
                }
              >
                <div className="w-full h-28 flex items-center justify-center overflow-hidden">
                  <img
                    src={
                      vehicleOption.image
                    }
                    alt={
                      vehicleOption.name
                    }
                    className="max-h-full max-w-full object-contain drop-shadow-sm mix-blend-multiply"
                  />
                </div>

                <strong className="text-lg font-bold text-slate-900">
                  {
                    vehicleOption.name
                  }
                </strong>
              </button>
            )
          )}
        </div>

        <div className="ob-form-grid mt-8 bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <Field label="License Plate Number">
            <input
              className="ob-input uppercase font-bold"
              placeholder="e.g. AB 1234"
              value={
                vehicle.plateNumber
              }
              onChange={(e) =>
                setVehicle({
                  ...vehicle,
                  plateNumber:
                    e.target.value,
                })
              }
            />
          </Field>

          <Field label="Operating Region">
            <div className="ob-select-wrap">
              <select
                className="ob-input font-medium"
                value={
                  vehicle.region
                }
                onChange={(e) =>
                  setVehicle({
                    ...vehicle,
                    region:
                      e.target.value,
                  })
                }
              >
                <option>
                  West (Freetown)
                </option>
                <option>
                  East (Kenema, Kono)
                </option>
                <option>
                  South (Bo)
                </option>
                <option>
                  North (Makeni)
                </option>
              </select>
            </div>
          </Field>
        </div>

        <div className="ob-actions mt-8">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(
                '/onboarding/selfie'
              )
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!isValid}
            onClick={() =>
              navigate(
                '/onboarding/review'
              )
            }
          >
            Continue
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function ReviewPage() {
  const {
    session,
    submitKycForReview,
    loading,
  } = useAuth();

  const navigate = useNavigate();
  const role = getActiveRole();

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [info] =
    useOnboardingState<OnboardingPersonalInfo>(
      'ob_personal',
      {}
    );

  const [identity] =
    useOnboardingState<
      Partial<IdentityInfo>
    >(
      'ob_identity',
      {}
    );

  const [merchant] =
    useOnboardingState<
      Partial<MerchantInfo> & {
        infrastructure?: string;
      }
    >(
      'ob_merchant',
      {}
    );

  const [vehicle] =
    useOnboardingState<{
      type: string;
      plateNumber: string;
      region: string;
    }>(
      'ob_vehicle_details',
      {
        type: '',
        plateNumber: '',
        region: '',
      }
    );

  const displayPhone =
    normalizePhone(
      info.phone ??
        session?.user?.phone ??
        ''
    ) ||
    'Phone number not provided';

  const handleFinalSubmit =
    async () => {
      if (
        isSubmitting ||
        loading
      ) {
        return;
      }

      if (!session) {
        alert(
          'Your session has expired. Please sign in again and continue your registration.'
        );

        navigate('/login');
        return;
      }

      if (!displayPhone ||
        displayPhone ===
          'Phone number not provided'
      ) {
        alert(
          'Please return to Personal Information and enter your phone number before submitting.'
        );

        navigate(
          '/onboarding/personal'
        );
        return;
      }

      setIsSubmitting(true);

      try {
        await submitKycForReview();
      } catch (error: any) {
        console.error(
          'Error submitting onboarding:',
          error
        );

        const message =
          error?.message ||
          'Failed to submit your verification details. Please try again.';

        alert(message);
      } finally {
        setIsSubmitting(false);
      }
    };

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          Review your submission
        </h2>

        <p className="ob-subtitle">
          Please check everything is correct
          before submitting for verification.
        </p>

        <div className="space-y-6 mt-8">
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                <FileText className="text-[#184f9a]" size={20} />
                Account type
              </div>
            </div>

            <div className="text-xl font-bold text-[#184f9a]">
              {roleLabels[role]}
            </div>
          </div>

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                <FileText className="text-[#184f9a]" size={20} />
                Personal information
              </div>

              <button
                type="button"
                className="text-sm font-semibold text-[#184f9a] hover:underline"
                onClick={() =>
                  navigate(
                    '/onboarding/personal'
                  )
                }
              >
                Edit
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <small className="block text-slate-500 mb-1">
                  Full name
                </small>

                <strong className="text-slate-900 text-lg">
                  {info.firstName ||
                    '—'}{' '}
                  {info.middleName
                    ? `${info.middleName} `
                    : ''}
                  {info.lastName ||
                    ''}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500 mb-1">
                  Phone
                </small>

                <strong className="text-slate-900 text-lg">
                  {displayPhone}
                </strong>
              </div>

              <div className="md:col-span-2">
                <small className="block text-slate-500 mb-1">
                  Address
                </small>

                <strong className="text-slate-900 text-lg">
                  {info.residentialAddress ||
                    '—'}
                  {info.city
                    ? `, ${info.city}`
                    : ''}
                </strong>
              </div>
            </div>
          </div>

          {role === 'merchant' && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                  <Store className="text-[#184f9a]" size={20} />
                  Business Details
                </div>

                <button
                  type="button"
                  className="text-sm font-semibold text-[#184f9a] hover:underline"
                  onClick={() =>
                    navigate(
                      '/onboarding/identity'
                    )
                  }
                >
                  Edit
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <small className="block text-slate-500 mb-1">
                    Infrastructure
                  </small>

                  <strong className="text-slate-900 text-lg">
                    {merchant.infrastructure ||
                      '—'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500 mb-1">
                    Business name
                  </small>

                  <strong className="text-slate-900 text-lg">
                    {merchant.businessName ||
                      '—'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {role === 'driver' && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                  <CarFront className="text-[#184f9a]" size={20} />
                  Vehicle Details
                </div>

                <button
                  type="button"
                  className="text-sm font-semibold text-[#184f9a] hover:underline"
                  onClick={() =>
                    navigate(
                      '/onboarding/vehicle'
                    )
                  }
                >
                  Edit
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <small className="block text-slate-500 mb-1">
                    Vehicle Type
                  </small>

                  <strong className="text-slate-900 text-lg">
                    {vehicle.type ||
                      '—'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500 mb-1">
                    License Plate
                  </small>

                  <strong className="text-slate-900 text-lg uppercase">
                    {vehicle.plateNumber ||
                      '—'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500 mb-1">
                    Operating Region
                  </small>

                  <strong className="text-slate-900 text-lg">
                    {vehicle.region ||
                      '—'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 font-bold text-lg text-slate-900">
                <Check className="text-[#184f9a]" size={20} />
                Documents Attached
              </div>

              <button
                type="button"
                className="text-sm font-semibold text-[#184f9a] hover:underline"
                onClick={() =>
                  navigate(
                    '/onboarding/documents'
                  )
                }
              >
                Edit
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              {(
                role !== 'merchant' ||
                merchant.infrastructure !==
                  'Digital / Online Only' ||
                identity.idType !==
                  'Business Registration'
              ) && (
                <div className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg font-medium text-slate-700 shadow-sm">
                  <Check
                    className="text-[#32a84a]"
                    size={16}
                  />
                  ID Documents (
                  {identity.idType ||
                    'Attached'}
                  )
                </div>
              )}

              <div className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg font-medium text-slate-700 shadow-sm">
                <Check
                  className="text-[#32a84a]"
                  size={16}
                />
                Selfie Verification
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 p-4 bg-slate-50 rounded-xl flex items-start gap-3 text-sm text-slate-600 border border-slate-200">
          <ShieldCheck
            className="text-[#184f9a] shrink-0"
            size={20}
          />

          <span>
            By submitting, you confirm the
            information is accurate. False
            information may result in account
            suspension.
          </span>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(
                role === 'driver'
                  ? '/onboarding/vehicle'
                  : '/onboarding/selfie'
              )
            }
            disabled={
              isSubmitting ||
              loading
            }
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={
              handleFinalSubmit
            }
            disabled={
              isSubmitting ||
              loading
            }
          >
            {isSubmitting ||
            loading
              ? 'Submitting...'
              : 'Submit for verification'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SubmittedPage() {
  const {
    session,
    resubmitKycForReview,
  } = useAuth();

  const navigate = useNavigate();

  const isRejected =
    session?.kycStatus ===
    'rejected';

  const role =
    session?.roles?.includes(
      'driver'
    )
      ? 'driver'
      : session?.roles?.includes(
            'merchant'
          )
        ? 'merchant'
        : getActiveRole();

  const portalPath =
    role === 'driver'
      ? '/customer/driver'
      : role === 'merchant'
        ? '/customer/merchant'
        : '/customer/rider';

  const handleDashboard =
    () => {
      navigate(
        portalPath
      );
    };

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in ob-submitted-page text-center">
        {!isRejected ? (
          <>
            <div className="w-20 h-20 bg-green-100 text-[#32a84a] rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-100">
              <Check
                size={40}
                strokeWidth={3}
              />
            </div>

            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              Submission received!
            </h2>

            <p className="text-slate-500 mb-10 max-w-sm mx-auto text-lg">
              Your verification is now under
              review. We'll notify you within
              24–48 hours.
            </p>

            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 mb-10 text-left max-w-md mx-auto">
              <div className="flex justify-between items-center py-3 border-b border-slate-200">
                <span className="text-slate-500">
                  Submission date
                </span>

                <strong className="text-slate-900">
                  {new Date().toLocaleDateString(
                    'en-GB',
                    {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }
                  )}
                </strong>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-slate-200">
                <span className="text-slate-500">
                  KYC status
                </span>

                <strong className="text-orange-600 bg-orange-50 px-3 py-1 rounded-full text-sm">
                  Under Review
                </strong>
              </div>

              <div className="flex justify-between items-center py-3">
                <span className="text-slate-500">
                  Account type
                </span>

                <strong className="text-slate-900 capitalize">
                  {role}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="primary-button w-full max-w-md mx-auto py-4"
              onClick={
                handleDashboard
              }
            >
              Access dashboard
              <ArrowRight size={17} />
            </button>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-100">
              <AlertCircle
                size={40}
                strokeWidth={2.5}
              />
            </div>

            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              Verification needs attention.
            </h2>

            <p className="text-slate-500 mb-10 max-w-sm mx-auto text-lg">
              Your submission could not be
              verified. Please review the
              reason below and resubmit.
            </p>

            <div className="bg-red-50 text-red-700 rounded-2xl border border-red-200 p-6 mb-10 text-left max-w-md mx-auto flex gap-4">
              <AlertCircle
                className="shrink-0 mt-0.5"
                size={24}
              />

              <span className="font-medium">
                The ID document image is blurry
                or unreadable. Please upload a
                clearer copy.
              </span>
            </div>

            <button
              type="button"
              className="primary-button w-full max-w-md mx-auto py-4"
              onClick={
                resubmitKycForReview
              }
            >
              Update and resubmit
              <ArrowRight size={17} />
            </button>
          </>
        )}
      </div>
    </OnboardingShell>
  );
}

export function VerificationPage() {
  return (
    <SubmittedPage />
  );
}

function Guideline({
  text,
}: {
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 text-slate-700 font-medium">
      <div className="bg-white p-1 rounded-full shadow-sm text-[#32a84a]">
        <Check
          size={16}
          strokeWidth={3}
        />
      </div>

      {text}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={`field ${
        full
          ? 'field-full'
          : ''
      }`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
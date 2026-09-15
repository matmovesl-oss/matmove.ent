import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CarFront,
  Truck,
  Store,
  ArrowRight,
  ArrowLeft,
  Check,
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

type OnboardingPersonalInfo = Partial<PersonalInfo> & {
  phone?: string;
};

type VehicleState = {
  type: string;
  plateNumber: string;
  region: string;
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

  return [state, setPersistentState] as const;
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

/* =========================================================
   ROLE SELECTION
========================================================= */

export function RoleSelectionPage() {
  const navigate = useNavigate();

  const [selected, setSelected] =
    useState<UserRole | null>(() => {
      const stored =
        sessionStorage.getItem('ob_role');

      if (
        stored === 'rider' ||
        stored === 'driver' ||
        stored === 'merchant'
      ) {
        return stored;
      }

      return null;
    });

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

      navigate('/onboarding/personal');
    } catch (error) {
      console.error(
        'Failed to save account type:',
        error
      );

      alert(
        'Failed to save your account type. Please try again.'
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
        </p>

        <div className="role-choice-grid">
          {roles.map((roleOption) => {
            const isSelected =
              selected === roleOption.key;

            return (
              <button
                key={roleOption.key}
                type="button"
                className={
                  isSelected
                    ? 'role-choice-card selected'
                    : 'role-choice-card'
                }
                onClick={() =>
                  setSelected(roleOption.key)
                }
                disabled={isProcessing}
              >
                <div
                  className={
                    'icon-box tone-' +
                    roleOption.tone +
                    ' icon-lg'
                  }
                >
                  {roleOption.icon}
                </div>

                <strong>
                  {roleLabels[roleOption.key]}
                </strong>

                <span>
                  {roleDescriptions[
                    roleOption.key
                  ]}
                </span>

                {isSelected && (
                  <div className="selected-check">
                    <Check size={13} />
                  </div>
                )}
              </button>
            );
          })}
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
              !selected || isProcessing
            }
            onClick={handleContinue}
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

/* =========================================================
   PERSONAL INFORMATION
========================================================= */

export function PersonalInfoPage() {
  const navigate = useNavigate();

  const [info, setInfo] =
    useOnboardingState<OnboardingPersonalInfo>(
      'ob_personal',
      {
        firstName: '',
        middleName: '',
        lastName: '',
        phone: '',
        dateOfBirth: '',
        nationality: 'Sierra Leonean',
        country: 'Sierra Leone',
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
    normalizePhone(info.phone ?? '');

  const isValid = Boolean(
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
              value={info.firstName ?? ''}
              onChange={(e) =>
                update(
                  'firstName',
                  e.target.value
                )
              }
              placeholder="Aisha"
            />
          </Field>

          <Field label="Middle name">
            <input
              className="ob-input"
              value={info.middleName ?? ''}
              onChange={(e) =>
                update(
                  'middleName',
                  e.target.value
                )
              }
              placeholder="Mariama"
            />
          </Field>

          <Field label="Last name">
            <input
              className="ob-input"
              value={info.lastName ?? ''}
              onChange={(e) =>
                update(
                  'lastName',
                  e.target.value
                )
              }
              placeholder="Kamara"
            />
          </Field>

          <Field label="Phone number">
            <input
              className="ob-input"
              value={info.phone ?? ''}
              onChange={(e) =>
                update(
                  'phone',
                  e.target.value
                )
              }
              placeholder="+232 76 123 456"
              inputMode="tel"
            />
          </Field>

          <Field label="Date of birth">
            <input
              className="ob-input"
              type="date"
              value={info.dateOfBirth ?? ''}
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
              value={info.nationality ?? ''}
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
              value={info.country ?? ''}
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
                info.residentialAddress ?? ''
              }
              onChange={(e) =>
                update(
                  'residentialAddress',
                  e.target.value
                )
              }
              placeholder="123 Lumley Beach Road"
            />
          </Field>

          <Field label="City">
            <input
              className="ob-input"
              value={info.city ?? ''}
              onChange={(e) =>
                update(
                  'city',
                  e.target.value
                )
              }
              placeholder="Freetown"
            />
          </Field>
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
                phone: normalizedPhone,
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

/* =========================================================
   IDENTITY
========================================================= */

export function IdentityPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [identity, setIdentity] =
    useOnboardingState<
      Partial<IdentityInfo>
    >('ob_identity', {
      idType: '',
      idNumber: '',
      idIssuingCountry:
        'Sierra Leone',
      idExpiryDate: '',
    });

  const [driver, setDriver] =
    useOnboardingState<
      Partial<DriverInfo>
    >('ob_driver', {
      licenseNumber: '',
      licenseClass: '',
      issueDate: '',
      expiryDate: '',
    });

  const [merchant, setMerchant] =
    useOnboardingState<
      Partial<MerchantInfo> & {
        infrastructure?: string;
      }
    >('ob_merchant', {
      businessName: '',
      businessType: '',
      businessRegNumber: '',
      businessAddress: '',
      authRepName: '',
      authRepPhone: '',
      infrastructure:
        'Physical Shop / Location',
    });

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
    idTypes.includes(identity.idType)
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

        <div className="ob-form-grid">
          <Field label="ID type">
            <div className="ob-select-wrap">
              <select
                className="ob-input"
                value={currentIdType}
                onChange={(e) =>
                  updateId(
                    'idType',
                    e.target.value
                  )
                }
              >
                {idTypes.map(
                  (type) => (
                    <option key={type}>
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
          <div className="ob-form-grid mt-6">
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

            <Field label="License class">
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
              />
            </Field>
          </div>
        )}

        {role === 'merchant' && (
          <div className="ob-form-grid mt-6">
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
          </div>
        )}

        <div className="ob-actions mt-8">
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

/* =========================================================
   DOCUMENTS
========================================================= */

export function DocumentsPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [identity] =
    useOnboardingState<
      Partial<IdentityInfo>
    >('ob_identity', {});

  const currentIdType =
    identity.idType || 'National ID';

  const displayDocs: {
    id: DocumentType;
    label: string;
    required: boolean;
  }[] = [
    {
      id: 'id_front',
      label:
        role === 'driver'
          ? "Driver's License"
          : currentIdType === 'Passport'
          ? 'Passport'
          : currentIdType ===
            'Business Registration'
          ? 'Business Registration'
          : 'National ID (Front)',
      required: true,
    },
  ];

  const [docs, setDocs] =
    useOnboardingState<
      Record<string, any>
    >('ob_docs', {});

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
    const updatedDocs = {
      ...docs,
    };

    delete updatedDocs[type];

    setDocs(updatedDocs);
  };

  const allUploaded =
    displayDocs
      .filter(
        (doc) => doc.required
      )
      .every(
        (doc) =>
          docs[doc.id]?.status ===
            'uploaded' ||
          Boolean(docs[doc.id]?.url) ||
          Boolean(
            docs[doc.id]?.storagePath
          ) ||
          Boolean(
            docs[doc.id]?.storage_path
          )
      );

  return (
    <OnboardingShell step={5}>
      <style>
        {`
          .premium-dropzones [data-doc-type] {
            border: 2px dashed #cbd5e1;
            border-radius: 1.25rem;
            padding: 2.5rem 2rem;
            text-align: center;
            background: #f8fafc;
            transition: all 0.2s ease-in-out;
            margin-bottom: 1.5rem;
          }

          .premium-dropzones [data-doc-type]:hover {
            border-color: #184f9a;
            background: #f8fbff;
          }
        `}
      </style>

      <div className="ob-page animate-in premium-dropzones">
        <h2 className="ob-title">
          Upload your documents
        </h2>

        <p className="ob-subtitle">
          Upload clear and readable documents
          for verification.
        </p>

        <div className="doc-upload-list grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {displayDocs.map(
            (docConfig) => (
              <div
                key={docConfig.id}
                className="flex flex-col"
              >
                <span className="mb-3 font-bold text-slate-700 ml-1">
                  {docConfig.label}
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
                      className="mx-auto mb-4 text-[#184f9a]"
                      size={36}
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
                      doc
                    ) =>
                      handleUpload(
                        docConfig.id,
                        doc
                      )
                    }
                    onRemove={() =>
                      handleRemove(
                        docConfig.id
                      )
                    }
                  />
                </div>
              </div>
            )
          )}
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

/* =========================================================
   SELFIE
========================================================= */

export function SelfiePage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [selfie, setSelfie] =
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
        url: document.url,
        storagePath:
          (document as any).storagePath,
        storage_path:
          (document as any).storage_path,
        path:
          (document as any).path,
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
          Take a clear selfie so we can
          verify your identity.
        </p>

        <div className="flex flex-col md:flex-row gap-8 items-start mt-8">
          <div className="flex-1 w-full bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200 text-center relative">
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

/* =========================================================
   VEHICLE SELECTION
========================================================= */

export function VehicleSelectionPage() {
  const navigate = useNavigate();

  const [vehicle, setVehicle] =
    useOnboardingState<VehicleState>(
      'ob_vehicle',
      {
        type: '',
        plateNumber: '',
        region: 'West (Freetown)',
      }
    );

  const vehicleTypes = [
    {
      value: 'Bike',
      label: 'Bike',
      description:
        'Motorbike / Okada',
      image: '/bike.jpg',
    },
    {
      value: 'Car',
      label: 'Car',
      description:
        'Saloon / Sedan / SUV',
      image: '/car.jpg',
    },
    {
      value: 'Van',
      label: 'Van',
      description:
        'Minivan / Delivery Van',
      image: '/van.jpg',
    },
    {
      value: 'Keke',
      label: 'Keke',
      description:
        'Three-wheel commercial vehicle',
      image: '/keke.jpg',
    },
  ];

  const isValid = Boolean(
    vehicle.type &&
      vehicle.plateNumber?.trim() &&
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
          Tell us about the vehicle you
          will use with MatMove.
        </p>

        <div className="ob-form-grid mt-8 bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <Field
            label="Vehicle Type"
            full
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
              {vehicleTypes.map(
                (item) => {
                  const selected =
                    vehicle.type ===
                    item.value;

                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        setVehicle({
                          ...vehicle,
                          type: item.value,
                        })
                      }
                      className={
                        selected
                          ? 'relative text-left overflow-hidden rounded-2xl border-2 border-[#184f9a] bg-blue-50 shadow-lg transition-all'
                          : 'relative text-left overflow-hidden rounded-2xl border-2 border-slate-200 bg-white hover:border-blue-300 hover:shadow-md transition-all'
                      }
                    >
                      {selected && (
                        <div className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-[#184f9a] text-white flex items-center justify-center shadow-md">
                          <Check
                            size={15}
                          />
                        </div>
                      )}

                      <div className="w-full h-36 bg-white flex items-center justify-center overflow-hidden">
                        <img
                          src={item.image}
                          alt={
                            item.label +
                            ' vehicle'
                          }
                          className="w-full h-full object-contain p-4"
                        />
                      </div>

                      <div className="p-5">
                        <div className="font-extrabold text-slate-900 text-lg">
                          {item.label}
                        </div>

                        <div className="text-sm text-slate-500 mt-1">
                          {
                            item.description
                          }
                        </div>
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </Field>

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
                    e.target.value.toUpperCase(),
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
                <option value="West (Freetown)">
                  West (Freetown)
                </option>

                <option value="East (Kenema, Kono)">
                  East (Kenema, Kono)
                </option>

                <option value="South (Bo)">
                  South (Bo)
                </option>

                <option value="North (Makeni)">
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

/* =========================================================
   REVIEW / FINAL KYC SUBMISSION
========================================================= */

export function ReviewPage() {
  const { session, loading } =
    useAuth();

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
    >('ob_identity', {});

  const [driver] =
    useOnboardingState<
      Partial<DriverInfo>
    >('ob_driver', {});

  const [merchant] =
    useOnboardingState<
      Partial<MerchantInfo> & {
        infrastructure?: string;
      }
    >('ob_merchant', {});

  const [vehicle] =
    useOnboardingState<VehicleState>(
      'ob_vehicle',
      {
        type: '',
        plateNumber: '',
        region: '',
      }
    );

  const [docs] =
    useOnboardingState<
      Record<string, any>
    >('ob_docs', {});

  const [selfieData, setSelfieData] =
    useState<any>(null);

  useEffect(() => {
    const selfieRaw =
      sessionStorage.getItem(
        'ob_selfie'
      );

    if (!selfieRaw) {
      setSelfieData(null);
      return;
    }

    try {
      setSelfieData(
        JSON.parse(selfieRaw)
      );
    } catch {
      setSelfieData(null);
    }
  }, []);

  const displayPhone =
    normalizePhone(
      info.phone ??
        session?.user?.phone ??
        ''
    );

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
          'Session expired. Please sign in again.'
        );

        navigate('/login');
        return;
      }

      if (!displayPhone) {
        alert(
          'Phone number is missing. Please go back and enter your phone number.'
        );

        navigate(
          '/onboarding/personal'
        );

        return;
      }

      if (
        role === 'driver' &&
        !vehicle.type
      ) {
        alert(
          'Please select your vehicle type.'
        );

        navigate(
          '/onboarding/vehicle'
        );

        return;
      }

      if (
        role === 'driver' &&
        !vehicle.plateNumber?.trim()
      ) {
        alert(
          'Please enter your vehicle license plate number.'
        );

        navigate(
          '/onboarding/vehicle'
        );

        return;
      }

      if (
        role === 'driver' &&
        !vehicle.region
      ) {
        alert(
          'Please select your operating region.'
        );

        navigate(
          '/onboarding/vehicle'
        );

        return;
      }

      if (
        role === 'driver' &&
        !driver.licenseNumber?.trim()
      ) {
        alert(
          'Please enter your driver license number.'
        );

        navigate(
          '/onboarding/identity'
        );

        return;
      }

      if (
        role === 'driver' &&
        !driver.licenseClass?.trim()
      ) {
        alert(
          'Please enter your driver license class.'
        );

        navigate(
          '/onboarding/identity'
        );

        return;
      }

      setIsSubmitting(true);

      try {
        const documentEntries =
          Object.entries(docs)
            .filter(
              ([, document]) =>
                document &&
                (
                  document.status ===
                    'uploaded' ||
                  document.url ||
                  document.storagePath ||
                  document.storage_path
                )
            )
            .map(
              ([type, document]) => ({
                document_type:
                  type,

                storage_path:
                  document.storagePath ||
                  document.storage_path ||
                  document.path ||
                  document.url ||
                  '',

                file_name:
                  document.fileName ||
                  document.file_name ||
                  null,

                file_size_bytes:
                  document.fileSize ||
                  document.file_size_bytes ||
                  null,
              })
            );

        if (
          selfieData &&
          (
            selfieData.storagePath ||
            selfieData.storage_path ||
            selfieData.path ||
            selfieData.url
          )
        ) {
          documentEntries.push({
            document_type:
              'selfie',

            storage_path:
              selfieData.storagePath ||
              selfieData.storage_path ||
              selfieData.path ||
              selfieData.url ||
              '',

            file_name:
              selfieData.fileName ||
              selfieData.file_name ||
              null,

            file_size_bytes:
              selfieData.fileSize ||
              selfieData.file_size_bytes ||
              null,
          });
        }

        if (
          documentEntries.length ===
          0
        ) {
          throw new Error(
            'Please upload the required verification document before submitting.'
          );
        }

        const {
          data,
          error,
        } = await supabase.rpc(
          'submit_customer_kyc_v2',
          {
            p_role: role,

            p_first_name:
              info.firstName?.trim() ||
              '',

            p_last_name:
              info.lastName?.trim() ||
              '',

            p_phone:
              displayPhone,

            p_address:
              info.residentialAddress?.trim() ||
              '',

            p_documents:
              documentEntries,

            p_vehicle_type:
              role === 'driver'
                ? vehicle.type ||
                  null
                : null,

            p_plate_number:
              role === 'driver'
                ? vehicle.plateNumber?.trim() ||
                  null
                : null,

            p_operating_region:
              role === 'driver'
                ? vehicle.region ||
                  null
                : null,

            p_driver_license_no:
              role === 'driver'
                ? driver.licenseNumber?.trim() ||
                  null
                : null,

            p_license_class:
              role === 'driver'
                ? driver.licenseClass?.trim() ||
                  null
                : null,
          }
        );

        if (error) {
          if (
            error.code ===
              '23505' ||
            error.message
              ?.toLowerCase()
              .includes(
                'profiles_phone_key'
              ) ||
            error.message
              ?.toLowerCase()
              .includes(
                'duplicate key value'
              )
          ) {
            throw new Error(
              'This phone number is already registered with MatMove. Please use a different phone number or sign in to your existing account.'
            );
          }

          throw error;
        }

        console.log(
          'KYC submission successful:',
          data
        );

        sessionStorage.setItem(
          'ob_submission_result',
          JSON.stringify(
            data ?? {}
          )
        );

        navigate(
          '/onboarding/submitted'
        );
      } catch (error: any) {
        console.error(
          'KYC submission error:',
          error
        );

        alert(
          error?.message ||
            'Failed to submit verification. Please try again.'
        );
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

        <div className="space-y-6 mt-8">
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="text-xl font-bold text-[#184f9a]">
              {roleLabels[role]}
            </div>
          </div>

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <small className="block text-slate-500">
                  Full name
                </small>

                <strong className="text-slate-900">
                  {info.firstName}{' '}
                  {info.middleName
                    ? `${info.middleName} `
                    : ''}
                  {info.lastName}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">
                  Phone
                </small>

                <strong className="text-slate-900">
                  {displayPhone}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">
                  Date of birth
                </small>

                <strong className="text-slate-900">
                  {info.dateOfBirth ||
                    'Not provided'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">
                  Nationality
                </small>

                <strong className="text-slate-900">
                  {info.nationality ||
                    'Not provided'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">
                  City
                </small>

                <strong className="text-slate-900">
                  {info.city ||
                    'Not provided'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">
                  Country
                </small>

                <strong className="text-slate-900">
                  {info.country ||
                    'Not provided'}
                </strong>
              </div>

              <div className="md:col-span-2">
                <small className="block text-slate-500">
                  Residential address
                </small>

                <strong className="text-slate-900">
                  {info.residentialAddress ||
                    'Not provided'}
                </strong>
              </div>
            </div>
          </div>

          {role === 'driver' && (
            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
              <h3 className="font-extrabold text-slate-900 mb-5">
                Vehicle information
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-5 gap-x-8">
                <div>
                  <small className="block text-slate-500">
                    Vehicle type
                  </small>

                  <strong className="text-slate-900">
                    {vehicle.type ||
                      'Not selected'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    License plate
                  </small>

                  <strong className="text-slate-900 uppercase">
                    {vehicle.plateNumber ||
                      'Not provided'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    Operating region
                  </small>

                  <strong className="text-slate-900">
                    {vehicle.region ||
                      'Not selected'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    Driver license
                  </small>

                  <strong className="text-slate-900">
                    {driver.licenseNumber ||
                      'Not provided'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    License class
                  </small>

                  <strong className="text-slate-900">
                    {driver.licenseClass ||
                      'Not provided'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {role === 'merchant' && (
            <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100">
              <h3 className="font-extrabold text-slate-900 mb-5">
                Business information
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-5 gap-x-8">
                <div>
                  <small className="block text-slate-500">
                    Business name
                  </small>

                  <strong className="text-slate-900">
                    {merchant.businessName ||
                      'Not provided'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    Infrastructure
                  </small>

                  <strong className="text-slate-900">
                    {merchant.infrastructure ||
                      'Not provided'}
                  </strong>
                </div>

                <div>
                  <small className="block text-slate-500">
                    Business registration
                  </small>

                  <strong className="text-slate-900">
                    {merchant.businessRegNumber ||
                      'Not provided'}
                  </strong>
                </div>

                <div className="md:col-span-2">
                  <small className="block text-slate-500">
                    Business address
                  </small>

                  <strong className="text-slate-900">
                    {merchant.businessAddress ||
                      'Not provided'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
            <h3 className="font-extrabold text-slate-900 mb-4">
              Verification documents
            </h3>

            <div className="space-y-3">
              {Object.entries(docs)
                .filter(
                  ([, document]) =>
                    Boolean(document)
                )
                .map(
                  ([type, document]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-200"
                    >
                      <div>
                        <div className="font-bold text-slate-900">
                          {type ===
                          'id_front'
                            ? role ===
                              'driver'
                              ? "Driver's License"
                              : 'Identity Document'
                            : type}
                        </div>

                        <div className="text-xs text-slate-500 mt-1">
                          {document.fileName ||
                            document.file_name ||
                            'Uploaded document'}
                        </div>
                      </div>

                      <div className="text-green-600">
                        <Check
                          size={20}
                        />
                      </div>
                    </div>
                  )
                )}

              {selfieData && (
                <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-200">
                  <div>
                    <div className="font-bold text-slate-900">
                      Selfie
                    </div>

                    <div className="text-xs text-slate-500 mt-1">
                      {selfieData.fileName ||
                        'Selfie uploaded'}
                    </div>
                  </div>

                  <div className="text-green-600">
                    <Check
                      size={20}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ob-actions mt-8">
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
            disabled={isSubmitting}
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={handleFinalSubmit}
            disabled={
              isSubmitting ||
              loading
            }
          >
            {isSubmitting
              ? 'Submitting...'
              : 'Submit for verification'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

/* =========================================================
   SUBMITTED
========================================================= */

export function SubmittedPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const portalPath =
    role === 'driver'
      ? '/customer/driver'
      : role === 'merchant'
      ? '/customer/merchant'
      : '/customer/rider';

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in text-center">
        <div className="w-20 h-20 bg-green-100 text-[#32a84a] rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} />
        </div>

        <h2 className="text-3xl font-bold mb-3">
          {role === 'rider'
            ? 'Account Approved!'
            : 'Submission received!'}
        </h2>

        <p className="text-slate-500 mb-10">
          {role === 'rider'
            ? 'Your account is ready. You can now request trips and load your wallet.'
            : 'Your verification is under review.'}
        </p>

        <button
          type="button"
          className="primary-button w-full py-4"
          onClick={() =>
            navigate(portalPath)
          }
        >
          Access dashboard
        </button>
      </div>
    </OnboardingShell>
  );
}

/* =========================================================
   VERIFICATION
========================================================= */

export function VerificationPage() {
  return <SubmittedPage />;
}

/* =========================================================
   FIELD
========================================================= */

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
      className={
        full
          ? 'field field-full'
          : 'field'
      }
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
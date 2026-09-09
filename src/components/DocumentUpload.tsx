import { useRef, useState } from 'react';
import {
  RefreshCw,
  Check,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  DocumentType,
  UploadedDocument,
} from '@/types';

interface DocumentUploadProps {
  type: DocumentType;
  document: UploadedDocument | undefined;
  onUpload: (doc: UploadedDocument) => void;
  onRemove: () => void;
}

interface StoredKycDocument {
  id: string;
  type: string;
  fileName: string;
  fileSize: number;
  status: 'uploaded';
}

const DOCUMENT_STORAGE_KEY =
  'ob_documents';

const SELFIE_STORAGE_KEY =
  'ob_selfie';

function saveDocumentMetadata(
  document: UploadedDocument
) {
  try {
    const existingRaw =
      sessionStorage.getItem(
        DOCUMENT_STORAGE_KEY
      );

    let existing: Record<
      string,
      StoredKycDocument
    > = {};

    if (existingRaw) {
      try {
        existing =
          JSON.parse(existingRaw);
      } catch {
        existing = {};
      }
    }

    existing[document.type] = {
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      fileSize: document.fileSize,
      status: 'uploaded',
    };

    sessionStorage.setItem(
      DOCUMENT_STORAGE_KEY,
      JSON.stringify(existing)
    );
  } catch (error) {
    console.error(
      'Could not save document metadata:',
      error
    );
  }
}

function removeDocumentMetadata(
  type: string
) {
  try {
    const existingRaw =
      sessionStorage.getItem(
        DOCUMENT_STORAGE_KEY
      );

    if (!existingRaw) {
      return;
    }

    let existing: Record<
      string,
      StoredKycDocument
    > = {};

    try {
      existing =
        JSON.parse(existingRaw);
    } catch {
      existing = {};
    }

    delete existing[type];

    if (
      Object.keys(existing).length ===
      0
    ) {
      sessionStorage.removeItem(
        DOCUMENT_STORAGE_KEY
      );
    } else {
      sessionStorage.setItem(
        DOCUMENT_STORAGE_KEY,
        JSON.stringify(existing)
      );
    }
  } catch (error) {
    console.error(
      'Could not remove document metadata:',
      error
    );
  }
}

function saveSelfieMetadata(
  document: UploadedDocument
) {
  try {
    const stored: StoredKycDocument = {
      id: document.id,
      type: 'selfie',
      fileName: document.fileName,
      fileSize: document.fileSize,
      status: 'uploaded',
    };

    sessionStorage.setItem(
      SELFIE_STORAGE_KEY,
      JSON.stringify(stored)
    );
  } catch (error) {
    console.error(
      'Could not save selfie metadata:',
      error
    );
  }
}

function removeSelfieMetadata() {
  try {
    sessionStorage.removeItem(
      SELFIE_STORAGE_KEY
    );
  } catch (error) {
    console.error(
      'Could not remove selfie metadata:',
      error
    );
  }
}

export function DocumentUpload({
  type,
  document,
  onUpload,
  onRemove,
}: DocumentUploadProps) {
  const { session } = useAuth();

  const inputRef =
    useRef<HTMLInputElement>(null);

  const [error, setError] =
    useState('');

  const [isDragging, setIsDragging] =
    useState(false);

  const handleFile = async (
    file: File
  ) => {
    setError('');

    if (!session?.user?.id) {
      setError(
        'Your session has expired. Please sign in again.'
      );
      return;
    }

    // --------------------------------------------------------
    // Validate file size
    // --------------------------------------------------------

    if (
      file.size >
      10 * 1024 * 1024
    ) {
      setError(
        'File is too large. Maximum size is 10MB.'
      );
      return;
    }

    // --------------------------------------------------------
    // Validate file type
    // --------------------------------------------------------

    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];

    if (
      !validTypes.includes(
        file.type
      )
    ) {
      setError(
        'Invalid file type. Please use JPG, PNG, WebP, or PDF.'
      );
      return;
    }

    // --------------------------------------------------------
    // Remove previous file when replacing
    // --------------------------------------------------------

    if (
      document?.id &&
      document.id !== 'temp'
    ) {
      await supabase.storage
        .from('kyc-documents')
        .remove([document.id]);

      removeDocumentMetadata(type);
    }

    const fileExt =
      file.name.includes('.')
        ? file.name
            .split('.')
            .pop()
            ?.toLowerCase()
        : 'bin';

    const filePath = `${
      session.user.id
    }/${type}-${Date.now()}.${fileExt}`;

    const localPreview =
      file.type ===
      'application/pdf'
        ? undefined
        : URL.createObjectURL(file);

    // --------------------------------------------------------
    // Show immediate uploading state
    // --------------------------------------------------------

    onUpload({
      id: 'temp',
      type,
      fileName: file.name,
      fileSize: file.size,
      status: 'uploading',
      uploadProgress: 10,
      previewUrl: localPreview,
    });

    try {
      // ------------------------------------------------------
      // Upload physical file to Supabase Storage
      // ------------------------------------------------------

      const {
        data,
        error: uploadError,
      } =
        await supabase.storage
          .from('kyc-documents')
          .upload(
            filePath,
            file,
            {
              cacheControl: '3600',
              upsert: false,
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      if (!data?.path) {
        throw new Error(
          'The document uploaded but no storage path was returned.'
        );
      }

      // ------------------------------------------------------
      // Build completed document object
      // ------------------------------------------------------

      const uploadedDocument: UploadedDocument =
        {
          id: data.path,
          type,
          fileName: file.name,
          fileSize: file.size,
          status: 'uploaded',
          uploadProgress: 100,
          previewUrl:
            localPreview,
        };

      // ------------------------------------------------------
      // Persist metadata for final KYC submission
      // ------------------------------------------------------

      saveDocumentMetadata(
        uploadedDocument
      );

      // ------------------------------------------------------
      // Update UI
      // ------------------------------------------------------

      onUpload(
        uploadedDocument
      );
    } catch (e: unknown) {
      onRemove();

      if (localPreview) {
        URL.revokeObjectURL(
          localPreview
        );
      }

      setError(
        e instanceof Error
          ? e.message
          : 'Failed to upload document.'
      );
    }
  };

  const handleRemove = async () => {
    if (
      document?.id &&
      document.id !== 'temp'
    ) {
      await supabase.storage
        .from('kyc-documents')
        .remove([document.id]);
    }

    removeDocumentMetadata(type);

    if (
      document?.previewUrl
    ) {
      URL.revokeObjectURL(
        document.previewUrl
      );
    }

    onRemove();
  };

  // ----------------------------------------------------------
  // Empty upload state
  // ----------------------------------------------------------

  if (!document) {
    return (
      <div
        className={`absolute inset-0 z-10 cursor-pointer rounded-2xl ${
          isDragging
            ? 'bg-[#184f9a]/5'
            : ''
        }`}
        onClick={() =>
          inputRef.current?.click()
        }
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() =>
          setIsDragging(false)
        }
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);

          const file =
            event.dataTransfer
              .files[0];

          if (file) {
            handleFile(file);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file =
              event.target.files?.[0];

            if (file) {
              handleFile(file);
            }

            event.target.value = '';
          }}
        />

        {error && (
          <div className="absolute bottom-2 left-0 w-full text-center text-red-600 text-sm font-medium flex items-center justify-center gap-1 px-3">
            <AlertCircle
              size={14}
            />
            {error}
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------
  // Uploaded state
  // ----------------------------------------------------------

  return (
    <div className="w-full relative z-20">
      <div className="w-full h-48 mb-4 rounded-xl overflow-hidden bg-slate-100 border-2 border-slate-200 shadow-sm relative group">
        {document.previewUrl ? (
          <img
            src={
              document.previewUrl
            }
            alt="Document preview"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-100">
            <span className="font-medium text-sm">
              PDF Document
            </span>
          </div>
        )}

        {document.status ===
          'uploading' && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <RefreshCw
              size={24}
              className="animate-spin mb-2"
            />

            <span className="font-medium text-sm">
              Uploading securely...
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#32a84a]">
          <Check size={16} />
          Uploaded
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() =>
              inputRef.current?.click()
            }
            className="text-sm font-medium text-[#184f9a] hover:underline"
          >
            Replace
          </button>

          <button
            type="button"
            onClick={
              handleRemove
            }
            className="text-sm font-medium text-red-500 hover:underline"
          >
            Remove
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file =
            event.target.files?.[0];

          if (file) {
            handleFile(file);
          }

          event.target.value = '';
        }}
      />

      {error && (
        <div className="mt-2 text-red-600 text-xs font-medium flex items-center justify-center gap-1">
          <AlertCircle
            size={13}
          />
          {error}
        </div>
      )}
    </div>
  );
}

export function SelfieUpload({
  document,
  onUpload,
  onRemove,
}: {
  document:
    | UploadedDocument
    | undefined;

  onUpload: (
    doc: UploadedDocument
  ) => void;

  onRemove: () => void;
}) {
  const { session } =
    useAuth();

  const inputRef =
    useRef<HTMLInputElement>(null);

  const [error, setError] =
    useState('');

  const handleFile = async (
    file: File
  ) => {
    setError('');

    if (!session?.user?.id) {
      setError(
        'Your session has expired. Please sign in again.'
      );
      return;
    }

    if (
      file.size >
      10 * 1024 * 1024
    ) {
      setError(
        'File too large (Max 10MB)'
      );
      return;
    }

    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];

    if (
      !validTypes.includes(
        file.type
      )
    ) {
      setError(
        'Invalid selfie format. Please use JPG, PNG, or WebP.'
      );
      return;
    }

    // --------------------------------------------------------
    // Remove previous selfie when retaking
    // --------------------------------------------------------

    if (
      document?.id &&
      document.id !== 'temp'
    ) {
      await supabase.storage
        .from('kyc-documents')
        .remove([document.id]);

      removeSelfieMetadata();
    }

    const fileExt =
      file.name.includes('.')
        ? file.name
            .split('.')
            .pop()
            ?.toLowerCase()
        : 'jpg';

    const filePath = `${
      session.user.id
    }/selfie-${Date.now()}.${fileExt}`;

    const localPreview =
      URL.createObjectURL(file);

    onUpload({
      id: 'temp',
      type: 'selfie',
      fileName: file.name,
      fileSize: file.size,
      status: 'uploading',
      uploadProgress: 10,
      previewUrl: localPreview,
    });

    try {
      const {
        data,
        error: uploadError,
      } =
        await supabase.storage
          .from('kyc-documents')
          .upload(
            filePath,
            file,
            {
              cacheControl: '3600',
              upsert: false,
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      if (!data?.path) {
        throw new Error(
          'The selfie uploaded but no storage path was returned.'
        );
      }

      const uploadedSelfie:
        UploadedDocument = {
        id: data.path,
        type: 'selfie',
        fileName: file.name,
        fileSize: file.size,
        status: 'uploaded',
        uploadProgress: 100,
        previewUrl: localPreview,
      };

      saveSelfieMetadata(
        uploadedSelfie
      );

      onUpload(
        uploadedSelfie
      );
    } catch (e: unknown) {
      onRemove();

      URL.revokeObjectURL(
        localPreview
      );

      setError(
        e instanceof Error
          ? e.message
          : 'Upload failed'
      );
    }
  };

  const handleRemove = async () => {
    if (
      document?.id &&
      document.id !== 'temp'
    ) {
      await supabase.storage
        .from('kyc-documents')
        .remove([document.id]);
    }

    removeSelfieMetadata();

    if (
      document?.previewUrl
    ) {
      URL.revokeObjectURL(
        document.previewUrl
      );
    }

    onRemove();
  };

  // ----------------------------------------------------------
  // Empty selfie state
  // ----------------------------------------------------------

  if (!document) {
    return (
      <>
        <button
          type="button"
          onClick={() =>
            inputRef.current?.click()
          }
          className="bg-[#184f9a] text-white px-6 py-3 rounded-xl font-semibold flex items-center gap-2 mx-auto hover:bg-[#123e7a] transition-all shadow-md"
        >
          Take Selfie
        </button>

        {error && (
          <div className="text-red-600 text-sm font-medium mt-3 flex items-center justify-center gap-1">
            <AlertCircle
              size={14}
            />
            {error}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          className="hidden"
          onChange={(event) => {
            const file =
              event.target.files?.[0];

            if (file) {
              handleFile(file);
            }

            event.target.value = '';
          }}
        />
      </>
    );
  }

  // ----------------------------------------------------------
  // Uploaded selfie state
  // ----------------------------------------------------------

  return (
    <div className="w-full flex flex-col items-center relative z-20">
      <div className="w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 border-[#184f9a] shadow-xl relative mb-6">
        {document.previewUrl ? (
          <img
            src={
              document.previewUrl
            }
            alt="Selfie"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400 text-sm">
            Selfie uploaded
          </div>
        )}

        {document.status ===
          'uploading' && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <RefreshCw
              size={24}
              className="animate-spin"
            />
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button
          type="button"
          onClick={() =>
            inputRef.current?.click()
          }
          className="bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-200 transition-colors"
        >
          Retake
        </button>

        <button
          type="button"
          onClick={
            handleRemove
          }
          className="bg-red-50 text-red-600 px-5 py-2.5 rounded-xl font-semibold hover:bg-red-100 transition-colors"
        >
          Remove
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        className="hidden"
        onChange={(event) => {
          const file =
            event.target.files?.[0];

          if (file) {
            handleFile(file);
          }

          event.target.value = '';
        }}
      />

      {error && (
        <div className="text-red-600 text-xs font-medium mt-3 flex items-center justify-center gap-1">
          <AlertCircle
            size={13}
          />
          {error}
        </div>
      )}
    </div>
  );
}
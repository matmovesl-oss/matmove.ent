import { useRef, useState } from 'react';
import { RefreshCw, Check, X, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { DocumentType, UploadedDocument } from '@/types';

interface DocumentUploadProps {
  type: DocumentType;
  document: UploadedDocument | undefined;
  onUpload: (doc: UploadedDocument) => void;
  onRemove: () => void;
}

export function DocumentUpload({ type, document, onUpload, onRemove }: DocumentUploadProps) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError('');
    
    // 1. Validate File Size (Max 10MB) and Type
    if (file.size > 10 * 1024 * 1024) {
      return setError('File is too large. Maximum size is 10MB.');
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      return setError('Invalid file type. Please use JPG, PNG, WebP, or PDF.');
    }

    const fileExt = file.name.split('.').pop();
    const filePath = `${session?.user.id}/${type}-${Date.now()}.${fileExt}`;
    const localPreview = URL.createObjectURL(file);

    // 2. Set UI to Uploading state instantly for a premium feel
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
      // 3. Upload to secure Supabase Bucket
      const { data, error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      // 4. Update UI to success state
      onUpload({
        id: data.path,
        type,
        fileName: file.name,
        fileSize: file.size,
        status: 'uploaded',
        uploadProgress: 100,
        previewUrl: localPreview, 
      });
    } catch (e: any) {
      onRemove();
      setError(e.message || 'Failed to upload document.');
    }
  };

  const handleRemove = async () => {
    if (document?.id && document.id !== 'temp') {
      await supabase.storage.from('kyc-documents').remove([document.id]);
    }
    onRemove();
  };

  // If no document is selected, render an invisible dropzone over the parent wrapper
  if (!document) {
    return (
      <div 
        className={`absolute inset-0 z-10 cursor-pointer rounded-2xl ${isDragging ? 'bg-[#184f9a]/5' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {error && <div className="absolute bottom-2 left-0 w-full text-center text-red-600 text-sm font-medium flex items-center justify-center gap-1"><AlertCircle size={14} /> {error}</div>}
      </div>
    );
  }

  return (
    <div className="w-full relative z-20">
      {/* Image Preview constrained to look premium */}
      <div className="w-full h-48 mb-4 rounded-xl overflow-hidden bg-slate-100 border-2 border-slate-200 shadow-sm relative group">
        {document.previewUrl ? (
          <img src={document.previewUrl} alt="Document preview" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-100">PDF Document</div>
        )}
        
        {document.status === 'uploading' && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <RefreshCw size={24} className="animate-spin mb-2" />
            <span className="font-medium text-sm">Uploading securely...</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#32a84a]">
          <Check size={16} /> Uploaded
        </div>
        <div className="flex gap-3">
          <button onClick={() => inputRef.current?.click()} className="text-sm font-medium text-[#184f9a] hover:underline">Replace</button>
          <button onClick={handleRemove} className="text-sm font-medium text-red-500 hover:underline">Remove</button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}


export function SelfieUpload({ document, onUpload, onRemove }: { document: UploadedDocument | undefined; onUpload: (doc: UploadedDocument) => void; onRemove: () => void }) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setError('');
    if (file.size > 10 * 1024 * 1024) return setError('File too large (Max 10MB)');
    
    const fileExt = file.name.split('.').pop();
    const filePath = `${session?.user.id}/selfie-${Date.now()}.${fileExt}`;
    const localPreview = URL.createObjectURL(file);

    onUpload({ id: 'temp', type: 'selfie', fileName: file.name, fileSize: file.size, status: 'uploading', uploadProgress: 10, previewUrl: localPreview });

    try {
      const { data, error: uploadError } = await supabase.storage.from('kyc-documents').upload(filePath, file, { upsert: false });
      if (uploadError) throw uploadError;

      onUpload({ id: data.path, type: 'selfie', fileName: file.name, fileSize: file.size, status: 'uploaded', uploadProgress: 100, previewUrl: localPreview });
    } catch (e: any) {
      onRemove();
      setError(e.message || 'Upload failed');
    }
  };

  const handleRemove = async () => {
    if (document?.id && document.id !== 'temp') {
      await supabase.storage.from('kyc-documents').remove([document.id]);
    }
    onRemove();
  };

  if (!document) {
    return (
      <>
        <button onClick={() => inputRef.current?.click()} className="bg-[#184f9a] text-white px-6 py-3 rounded-xl font-semibold flex items-center gap-2 mx-auto hover:bg-[#123e7a] transition-all shadow-md">
          Take Selfie
        </button>
        {error && <div className="text-red-600 text-sm font-medium mt-3 flex items-center justify-center gap-1"><AlertCircle size={14} /> {error}</div>}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </>
    );
  }

  return (
    <div className="w-full flex flex-col items-center relative z-20">
      {/* Selfie Preview constrained */}
      <div className="w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 border-[#184f9a] shadow-xl relative mb-6">
        <img src={document.previewUrl} alt="Selfie" className="w-full h-full object-cover" />
        {document.status === 'uploading' && (
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <RefreshCw size={24} className="animate-spin" />
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button onClick={() => inputRef.current?.click()} className="bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-semibold hover:bg-slate-200 transition-colors">Retake</button>
        <button onClick={handleRemove} className="bg-red-50 text-red-600 px-5 py-2.5 rounded-xl font-semibold hover:bg-red-100 transition-colors">Remove</button>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}
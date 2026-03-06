export interface HeaderField {
  key: string;
  label: string;
  type: 'text' | 'dropdown';
  placeholder: string;
  required: boolean;
  isSystem: boolean;
  order: number;
  options: string[] | null;
}

export interface ScoringCategory {
  key: string;
  label: string;
  maxPoints: number;
  isSystem: boolean;
  order: number;
}

// type "file"     → isMediaFile=true,  isEmbedded=false → file upload widget
// type "embed"    → isMediaFile=false, isEmbedded=true  → URL/iframe textarea
// type "document" → system-only document upload slot
export interface MediaField {
  key: string;
  label: string;
  placeholder: string;
  type: 'file' | 'embed' | 'document';
  isSystem: boolean;
  order: number;
  accept: string[] | null; // only meaningful for type "file"
}
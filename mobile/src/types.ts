// Shared TypeScript models matching Knowledge Hub FastAPI REST contract

export interface ConnectionConfig {
  serverUrl: string;
  apiToken: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  auth_required: boolean;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface BilingualSegment {
  original_text?: string;
  translated_text?: string;
  warnings_json?: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  source: string;
  kind: "article" | "podcast" | "document" | string;
  author?: string;
  category?: string;
  published_at?: string;
  status?: string;
  mode?: string;
  translation_mode?: string;
  translation_provider?: string;
  translation_model?: string;
  audio_path?: string;
  source_audio_path?: string;
  audio_status?: string;
  audio_provider?: string;
  audio_duration_sec?: number;
  audio_position_sec?: number;
  reading_minutes?: number;
  listening_minutes?: number;
  position?: number;
  favorite?: boolean | number;
  is_read?: boolean | number;
  notes?: string;
  original?: string;
  translated?: string;
  transcript_json?: string;
  segments?: BilingualSegment[];
}

export interface DiscoverEntry {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  summary?: string;
  published_at?: string;
  is_read?: boolean | number;
  imported_item_id?: string | null;
}

export interface JobInfo {
  id: string;
  job_type: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | string;
  stage: string;
  progress: number;
  processed_segments?: number;
  total_segments?: number;
  provider?: string;
  model?: string;
  error_message?: string;
}

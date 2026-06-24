export interface NotificationSubject {
  title: string;
  url: string;
  latest_comment_url: string;
  type: string;
}

export interface NotificationRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    [key: string]: unknown;
  };
  html_url: string;
  [key: string]: unknown;
}

export interface NotificationThread {
  id: string;
  repository: NotificationRepository;
  subject: NotificationSubject;
  reason: string;
  unread: boolean;
  updated_at: string;
  last_read_at: string | null;
  url: string;
  subscription_url: string;
}

export interface HydrationResult {
  subject_body: string | null;
  comment_body: string | null;
  hydrated: boolean;
}

export interface FeedRecord {
  id: string;
  captured_at: string;
  reason: string;
  subject_type: string;
  title: string;
  repository: {
    full_name: string;
    html_url: string;
  };
  subject_url: string;
  latest_comment_url: string;
  subject_content: string | null;
  latest_comment_content: string | null;
  hydrated: boolean;
}

export interface CliOptions {
  tokenFile: string | undefined;
  output: string;
  verbose: boolean;
}

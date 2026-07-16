// Data-transfer shapes returned by the API and consumed by the UI. Keeping
// these explicit decouples the client from the Prisma row shape.

export interface TagDTO {
  id: string; // AppTag id (app-scoped)
  tagId: string;
  slug: string;
  name: string;
  stakeTotal: number;
  suggestedBy: string | null;
}

export interface AppDTO {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  iconUrl: string | null;
  category: string;
  chain: string;
  status: string;
  createdAt: string;
  submittedBy: string | null;
  voteCount: number;
  voteWeight: number;
  stakeTotal: number;
  viewCount: number;
  rankScore: number;
  tags: TagDTO[];
}

export interface SearchResult {
  apps: AppDTO[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    categories: { value: string; count: number }[];
    chains: { value: string; count: number }[];
    tags: { slug: string; name: string; count: number }[];
  };
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

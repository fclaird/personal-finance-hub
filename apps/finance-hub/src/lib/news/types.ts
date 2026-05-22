export type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  symbols: string[];
  category: string;
  source: string;
  /** Present for ingested posts (in-app display / symbol matching). */
  body?: string;
};

export type ParsedIngestPost = {
  title: string;
  body: string;
  link: string;
  contentHash: string;
};

export const CACTUSJXCK_SOURCE = "caktusjxck";
export const CACTUSJXCK_SOURCE_LABEL = "CaktusJxck";

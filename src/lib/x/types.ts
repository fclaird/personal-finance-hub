export type XDigestSectionId = "finance" | "world" | "politics";

export type XDigestIdea = { text: string; postIds: string[] };

export type XDigestSection = {
  id: XDigestSectionId;
  heading: string;
  ideas: XDigestIdea[];
};

export type XDigestPayload = {
  sections: XDigestSection[];
  posts: Record<string, { url: string; text: string; author: string; createdAt: string }>;
  generatedAt: string;
};

export type XSymbolPayload = {
  symbol: string;
  summary: string;
  posts: Array<{ id: string; url: string; text: string; author: string; createdAt: string }>;
  generatedAt: string;
};

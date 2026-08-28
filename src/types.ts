export type RepositoryId = string & { readonly __brand: "RepositoryId" };
export type RepositoryKind = "remote" | "local";

export interface RepositoryClassification {
  kind: "remote";
  host: string;
  ownerPath: string[];
  name: string;
  relativePath: string;
  canonicalRemote: string;
}

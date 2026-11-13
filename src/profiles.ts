import { ProfileSchema } from "./config.js";
import type { Profile } from "./contracts.js";

export interface ProfileRecord {
  id: string;
  revision: number;
  enabled: boolean;
  profile?: Profile;
}
export type ProfileMutation =
  { status: "updated"; record: ProfileRecord } | { status: "conflict" };

export class ProfileRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileRegistryError";
  }
}

interface ProfileRow {
  id: string;
  revision: number;
  profile_json: string | null;
  updated_at: string;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
function checkId(id: string): void {
  if (typeof id !== "string" || !ID.test(id))
    throw new ProfileRegistryError("INVALID_PROFILE_ID", "Invalid profile ID.");
}
function checkRevision(revision: number): void {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision >= Number.MAX_SAFE_INTEGER
  )
    throw new ProfileRegistryError(
      "INVALID_REVISION",
      "Invalid profile revision.",
    );
}
function profileValue(value: unknown): Profile {
  const parsed = ProfileSchema.safeParse(value);
  if (!parsed.success)
    throw new ProfileRegistryError(
      "INVALID_PROFILE",
      "Invalid profile configuration.",
    );
  return parsed.data;
}
function record(row: ProfileRow): ProfileRecord {
  try {
    checkId(row.id);
    if (
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      typeof row.updated_at !== "string"
    )
      throw Error();
    if (row.profile_json === null)
      return { id: row.id, revision: row.revision, enabled: false };
    if (typeof row.profile_json !== "string") throw Error();
    return {
      id: row.id,
      revision: row.revision,
      enabled: true,
      profile: profileValue(JSON.parse(row.profile_json)),
    };
  } catch {
    throw new ProfileRegistryError(
      "CORRUPT_PROFILE",
      "Stored profile configuration is invalid.",
    );
  }
}

export class ProfileRegistry {
  private readonly seeds = new Map<string, Profile>();
  constructor(
    private readonly db: D1Database,
    seeds: Record<string, Profile>,
  ) {
    for (const [id, value] of Object.entries(seeds)) {
      checkId(id);
      this.seeds.set(id, profileValue(value));
    }
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProfileRegistryError) throw error;
      throw new ProfileRegistryError(
        "PROFILE_STORAGE",
        "Profile storage is unavailable.",
      );
    }
  }

  private async stored(id: string): Promise<ProfileRecord | null> {
    return this.storage(async () => {
      const row = await this.db
        .prepare(
          "SELECT id, revision, profile_json, updated_at FROM review_profiles WHERE id = ?",
        )
        .bind(id)
        .first<ProfileRow>();
      return row ? record(row) : null;
    });
  }

  async list(): Promise<ProfileRecord[]> {
    return this.storage(async () => {
      const result = await this.db
        .prepare(
          "SELECT id, revision, profile_json, updated_at FROM review_profiles",
        )
        .all<ProfileRow>();
      if (!result.success || !Array.isArray(result.results)) throw Error();
      const records = new Map<string, ProfileRecord>();
      for (const [id, profile] of this.seeds)
        records.set(id, {
          id,
          revision: 0,
          enabled: true,
          profile: { ...profile },
        });
      for (const row of result.results) records.set(row.id, record(row));
      return [...records.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
    });
  }

  async resolve(
    id: string,
  ): Promise<{ profile: Profile; revision: number } | null> {
    checkId(id);
    const current = await this.stored(id);
    if (current)
      return current.enabled
        ? { profile: current.profile!, revision: current.revision }
        : null;
    const seed = this.seeds.get(id);
    return seed ? { profile: { ...seed }, revision: 0 } : null;
  }

  async set(
    id: string,
    profile: Profile,
    expectedRevision: number,
  ): Promise<ProfileMutation> {
    checkId(id);
    checkRevision(expectedRevision);
    return this.mutate(id, profileValue(profile), expectedRevision);
  }

  async remove(id: string, expectedRevision: number): Promise<ProfileMutation> {
    checkId(id);
    checkRevision(expectedRevision);
    return this.mutate(id, null, expectedRevision);
  }

  private async mutate(
    id: string,
    profile: Profile | null,
    expectedRevision: number,
  ): Promise<ProfileMutation> {
    return this.storage(async () => {
      const current = await this.stored(id);
      if (
        (current?.revision ?? 0) !== expectedRevision ||
        (profile === null && !current && !this.seeds.has(id))
      )
        return { status: "conflict" };
      const json = profile === null ? null : JSON.stringify(profile);
      const timestamp = new Date().toISOString();
      const statement =
        expectedRevision === 0
          ? this.db
              .prepare(
                "INSERT INTO review_profiles (id, revision, profile_json, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id, revision, profile_json, updated_at",
              )
              .bind(id, json, timestamp)
          : this.db
              .prepare(
                "UPDATE review_profiles SET revision = revision + 1, profile_json = ?, updated_at = ? WHERE id = ? AND revision = ? RETURNING id, revision, profile_json, updated_at",
              )
              .bind(json, timestamp, id, expectedRevision);
      const row = await statement.first<ProfileRow>();
      return row
        ? { status: "updated", record: record(row) }
        : { status: "conflict" };
    });
  }
}

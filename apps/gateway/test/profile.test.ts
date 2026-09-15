import "reflect-metadata";
import { PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT } from "@wallpaperdb/events";
import { container } from "tsyringe";
import { describe, expect, it, vi } from "vitest";
import { OpenSearchConnection } from "../src/connections/opensearch.js";
import { profilesIndexMapping } from "../src/opensearch/mappings.js";
import { ProfileRepository } from "../src/repositories/profile.repository.js";
import { WallpaperRepository } from "../src/repositories/wallpaper.repository.js";
import { IndexManagerService } from "../src/services/index-manager.service.js";
import { tester } from "./setup.js";

interface ProfileSnapshot {
    id: string;
    displayName: string;
    handle: string;
    claimGeneration: number;
    aliases?: Array<{ handle: string; claimGeneration: number }>;
    biographyMarkdown: string;
    pictureAssetId: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

function profileCreated(profile: ProfileSnapshot, eventId: string) {
    return {
        eventId,
        eventType: PROFILE_CREATED_SUBJECT,
        timestamp: profile.updatedAt,
        change: { type: "created" },
        profile,
    };
}

function profileUpdated(
    profile: ProfileSnapshot,
    eventId: string,
    before: string,
) {
    return {
        eventId,
        eventType: PROFILE_UPDATED_SUBJECT,
        timestamp: profile.updatedAt,
        change: {
            type: "display-name-changed",
            before,
            after: profile.displayName,
        },
        profile,
    };
}

async function query(query: string) {
    const response = await tester.getApp().inject({
        method: "POST",
        url: "/graphql",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ query }),
    });

    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 5000;
    let value = await read();
    while (!predicate(value) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        value = await read();
    }
    expect(predicate(value)).toBe(true);
    return value;
}

describe("Profile projection integration", () => {
    it("resolves scheduled aliases during grace and stops exactly at expiry before projection catches up", async () => {
        const expiresAt = "2030-01-02T12:00:00.000Z";
        const profile = {
            id: "user_alias_deadline",
            displayName: "Alias Owner",
            handle: "deadline-current",
            claimGeneration: 4,
            aliases: [
                { handle: "deadline-alias", claimGeneration: 1, expiresAt },
                { handle: "legacy-alias", claimGeneration: 2 },
                { handle: "retained-alias", claimGeneration: 3, expiresAt: null },
            ],
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 4,
            createdAt: "2030-01-01T12:00:00.000Z",
            updatedAt: "2030-01-01T12:00:00.000Z",
        };
        await container.resolve(ProfileRepository).project(profile);
        const read = () => query(`query {
            scheduled: profileByHandle(handle: "deadline-alias") { profile { id } }
            legacy: profileByHandle(handle: "legacy-alias") { profile { id } }
            retained: profileByHandle(handle: "retained-alias") { profile { id } }
            current: profileByHandle(handle: "deadline-current") { profile { id } }
        }`);
        const resolved = { profile: { id: profile.id } };
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            vi.setSystemTime(new Date(Date.parse(expiresAt) - 1));
            const grace = await read();
            expect(grace.errors).toBeUndefined();
            expect(grace.data).toEqual({
                scheduled: resolved, legacy: resolved, retained: resolved, current: resolved,
            });
            vi.setSystemTime(new Date(expiresAt));
            const expired = await read();
            expect(expired.errors).toBeUndefined();
            expect(expired.data).toEqual({
                scheduled: null, legacy: resolved, retained: resolved, current: resolved,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("adds alias routing to an existing Profile index without losing Profiles", async () => {
        const indexManager = container.resolve(IndexManagerService);
        const client = container.resolve(OpenSearchConnection).getClient();
        await indexManager.deleteIndex("profiles");
        await client.indices.create({
            index: indexManager.getIndexName("profiles"),
            body: {
                mappings: {
                    properties: Object.fromEntries(
                        Object.entries(profilesIndexMapping.properties).filter(([name]) => name !== "aliases"),
                    ),
                },
            },
        });
        const timestamp = "2026-01-01T00:00:00.000Z";
        const existing = {
            id: "user_existing_index",
            displayName: "Existing Profile",
            handle: "existing-profile",
            claimGeneration: 1,
            biographyMarkdown: "Preserved biography",
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const repository = container.resolve(ProfileRepository);
        await repository.project(existing);

        // This is the normal startup path, before Profile consumers start.
        await indexManager.createIndex();
        const preserved = await query(`query {
            profile(id: "${existing.id}") { id displayName biographyMarkdown version }
        }`);
        expect(preserved.data.profile).toEqual({
            id: existing.id,
            displayName: existing.displayName,
            biographyMarkdown: existing.biographyMarkdown,
            version: 1,
        });

        await repository.project({
            ...existing,
            handle: "updated-profile",
            claimGeneration: 2,
            aliases: [{ handle: existing.handle, claimGeneration: existing.claimGeneration }],
            version: 2,
        });
        const result = await query(`query {
            profileByHandle(handle: "existing-profile") {
                isAlias canonicalHandle profile { id }
            }
        }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.profileByHandle).toEqual({
            isAlias: true,
            canonicalHandle: "updated-profile",
            profile: { id: existing.id },
        });
    });

    it("selects the highest matching claim generation during projection lag", async () => {
        const timestamp = "2026-01-01T00:00:00.000Z";
        const base = {
            displayName: "Profile Owner",
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const repository = container.resolve(ProfileRepository);
        await repository.project({
            ...base,
            id: "user_stale_aliases",
            handle: "unrelated-current",
            claimGeneration: 100,
            aliases: [
                { handle: "reclaimed-current", claimGeneration: 10 },
                { handle: "reclaimed-alias", claimGeneration: 20 },
                { handle: "unrelated-alias", claimGeneration: 99 },
            ],
        });
        await repository.project({
            ...base,
            id: "user_current_winner",
            handle: "reclaimed-current",
            claimGeneration: 11,
        });
        await repository.project({
            ...base,
            id: "user_stale_current",
            handle: "reclaimed-current",
            claimGeneration: 9,
        });
        await repository.project({
            ...base,
            id: "user_alias_winner",
            handle: "canonical-alias-owner",
            claimGeneration: 40,
            aliases: [{ handle: "reclaimed-alias", claimGeneration: 21 }],
        });

        const result = await query(`query {
            current: profileByHandle(handle: "reclaimed-current") {
                isAlias canonicalHandle profile { id }
            }
            alias: profileByHandle(handle: "reclaimed-alias") {
                isAlias canonicalHandle profile { id }
            }
        }`);

        expect(result.errors).toBeUndefined();
        expect(result.data).toEqual({
            current: {
                isAlias: false,
                canonicalHandle: "reclaimed-current",
                profile: { id: "user_current_winner" },
            },
            alias: {
                isAlias: true,
                canonicalHandle: "canonical-alias-owner",
                profile: { id: "user_alias_winner" },
            },
        });
    });

    it("resolves former Handle aliases after projecting a Handle change", async () => {
        const timestamp = "2026-01-01T00:00:00.000Z";
        const original = {
            id: "user_handle_change",
            displayName: "Profile Owner",
            handle: "original-handle",
            claimGeneration: 1,
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(original, "evt_handle_created"),
        );
        const updated = {
            ...original,
            handle: "current-handle",
            claimGeneration: 2,
            aliases: [{ handle: original.handle, claimGeneration: original.claimGeneration }],
            version: 2,
            updatedAt: "2026-01-08T00:00:00.000Z",
        };
        await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, {
            eventId: "evt_handle_changed",
            eventType: PROFILE_UPDATED_SUBJECT,
            timestamp: updated.updatedAt,
            change: { type: "handle-changed", before: original.handle, after: updated.handle },
            profile: updated,
        });
        await eventually(
            () => query(`query { profile(id: "${original.id}") { version } }`),
            (result) => result.data.profile?.version === 2,
        );

        const result = await query(`query {
            current: profileByHandle(handle: "current-handle") {
                requestedHandle isAlias canonicalHandle profile { id canonicalPath }
            }
            previous: profileByHandle(handle: "Original-Handle") {
                requestedHandle isAlias canonicalHandle profile { id canonicalPath }
            }
            partial: profileByHandle(handle: "original") { profile { id } }
        }`);

        expect(result.errors).toBeUndefined();
        expect(result.data).toEqual({
            current: {
                requestedHandle: "current-handle",
                isAlias: false,
                canonicalHandle: "current-handle",
                profile: { id: original.id, canonicalPath: "/profiles/@current-handle" },
            },
            previous: {
                requestedHandle: "Original-Handle",
                isAlias: true,
                canonicalHandle: "current-handle",
                profile: { id: original.id, canonicalPath: "/profiles/@current-handle" },
            },
            partial: null,
        });
        const aliasEnumeration = await tester.getApp().inject({
            method: "POST",
            url: "/graphql",
            payload: { query: `query { profile(id: "${original.id}") { aliases } }` },
        });
        expect(aliasEnumeration.json().errors[0].message).toContain(
            'Cannot query field "aliases" on type "Profile"',
        );
    });

    it("projects scheduled aliases without exposing the owner's alias list through GraphQL", async () => {
        const timestamp = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const profile = {
            id: "user_scheduled_alias",
            displayName: "Alias Owner",
            handle: "scheduled-current",
            claimGeneration: 2,
            aliases: [{ handle: "scheduled-alias", claimGeneration: 1, createdAt: timestamp, expiresAt }],
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 3,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, {
            eventId: "evt_alias_scheduled",
            eventType: PROFILE_UPDATED_SUBJECT,
            timestamp,
            change: { type: "alias-expiry-scheduled", handle: "scheduled-alias", before: null, after: expiresAt },
            profile,
        });
        await eventually(
            () => query(`query { profile(id: "${profile.id}") { version } }`),
            (result) => result.data.profile?.version === 3,
        );
        const result = await query(`query {
            profileByHandle(handle: "scheduled-alias") {
                isAlias canonicalHandle profile { id }
            }
        }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.profileByHandle).toEqual({
            isAlias: true,
            canonicalHandle: profile.handle,
            profile: { id: profile.id },
        });
        const projected = await container.resolve(ProfileRepository).findById(profile.id);
        expect(projected?.aliases).toEqual(profile.aliases);
        const enumeration = await tester.getApp().inject({
            method: "POST",
            url: "/graphql",
            payload: { query: `query { profile(id: "${profile.id}") { aliases } }` },
        });
        expect(enumeration.json().errors[0].message).toContain('Cannot query field "aliases" on type "Profile"');
    });

    it("projects an updated Display name through the public GraphQL Profile", async () => {
        const createdAt = "2026-01-01T00:00:00.000Z";
        const original = {
            id: "user_display_name_update",
            displayName: "Before",
            handle: "before",
            claimGeneration: 1,
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 1,
            createdAt,
            updatedAt: createdAt,
        };
        const updated = {
            ...original,
            displayName: "After",
            version: 2,
            updatedAt: "2026-01-02T00:00:00.000Z",
        };

        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(original, "evt_display_name_created"),
        );
        await tester.nats.publishEvent(
            PROFILE_UPDATED_SUBJECT,
            profileUpdated(updated, "evt_display_name_updated", original.displayName),
        );

        const result = await eventually(
            () => query(`query { profile(id: "user_display_name_update") { displayName version } }`),
            (value) => value.data.profile?.version === 2,
        );
        expect(result.data.profile).toEqual({ displayName: "After", version: 2 });
    });

    it("atomically ignores duplicate and stale Profile versions", async () => {
        const createdAt = "2026-01-01T00:00:00.000Z";
        const current = {
            id: "user_profile_versions",
            displayName: "Current Name",
            handle: "current-handle",
            claimGeneration: 2,
            biographyMarkdown: "Current biography",
            pictureAssetId: null,
            version: 2,
            createdAt,
            updatedAt: "2026-01-03T00:00:00.000Z",
        };

        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(current, "evt_profile_current"),
        );
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                { ...current, version: 3, displayName: "Final Name", handle: "final-handle" },
                "evt_profile_final",
            ),
        );
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                {
                    ...current,
                    version: 3,
                    displayName: "Duplicate overwrite",
                    handle: "duplicate-handle",
                },
                "evt_profile_duplicate",
            ),
        );
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                {
                    ...current,
                    displayName: "Stale overwrite",
                    handle: "stale-handle",
                    version: 1,
                    updatedAt: "2026-01-02T00:00:00.000Z",
                },
                "evt_profile_stale",
            ),
        );
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                {
                    ...current,
                    id: "user_profile_marker",
                    displayName: "Marker",
                    handle: "marker",
                    version: 1,
                },
                "evt_profile_marker",
            ),
        );

        await eventually(
            () => container.resolve(ProfileRepository).findById("user_profile_marker"),
            (value) => value !== null,
        );
        const profile = await container.resolve(ProfileRepository).findById("user_profile_versions");

        const result = await query(`
            query {
                profile(id: "user_profile_versions") {
                    displayName
                    handle
                    version
                }
            }
        `);
        expect(result.errors).toBeUndefined();
        expect(profile?.version).toBe(3);
        expect(result.data.profile).toEqual({
            displayName: "Final Name",
            handle: "final-handle",
            version: 3,
        });
    });

    it("reads Profiles exactly by ID and current Handle with canonical picture data", async () => {
        const timestamp = "2026-02-01T00:00:00.000Z";
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                {
                    id: "user_profile_reads",
                    displayName: "Profile Reader",
                    handle: "profile-reader",
                    claimGeneration: 1,
                    biographyMarkdown: "Reads profiles",
                    pictureAssetId: "pic_profile_reads",
                    version: 1,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                "evt_profile_reads",
            ),
        );
        await tester.nats.publishEvent(
            PROFILE_CREATED_SUBJECT,
            profileCreated(
                {
                    id: "user_profile_no_picture",
                    displayName: "No Picture",
                    handle: "no-picture",
                    claimGeneration: 1,
                    biographyMarkdown: "",
                    pictureAssetId: null,
                    version: 1,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                "evt_profile_no_picture",
            ),
        );

        await eventually(
            () => container.resolve(ProfileRepository).findById("user_profile_no_picture"),
            (value) => value !== null,
        );
        const result = await query(`
                    query {
                        byId: profile(id: "user_profile_reads") {
                            id
                            displayName
                            handle
                            biographyMarkdown
                            canonicalPath
                            picture { id url }
                        }
                        byHandle: profileByHandle(handle: "profile-reader") {
                            requestedHandle
                            isAlias
                            canonicalHandle
                            profile { id handle canonicalPath }
                        }
                        mixedCaseHandle: profileByHandle(handle: "Profile-Reader") {
                            requestedHandle
                            isAlias
                            canonicalHandle
                            profile { id handle canonicalPath }
                        }
                        partialHandle: profileByHandle(handle: "profile-read") { profile { id } }
                        missingId: profile(id: "user_profile_missing") { id }
                        noPicture: profileByHandle(handle: "no-picture") { profile { picture { id } } }
                    }
                `);

        expect(result.errors).toBeUndefined();
        expect(result.data).toEqual({
            byId: {
                id: "user_profile_reads",
                displayName: "Profile Reader",
                handle: "profile-reader",
                biographyMarkdown: "Reads profiles",
                canonicalPath: "/profiles/@profile-reader",
                picture: {
                    id: "pic_profile_reads",
                    url: `${process.env.MEDIA_SERVICE_URL}/profile-pictures/pic_profile_reads`,
                },
            },
            byHandle: {
                requestedHandle: "profile-reader",
                isAlias: false,
                canonicalHandle: "profile-reader",
                profile: {
                    id: "user_profile_reads",
                    handle: "profile-reader",
                    canonicalPath: "/profiles/@profile-reader",
                },
            },
            mixedCaseHandle: {
                requestedHandle: "Profile-Reader",
                isAlias: false,
                canonicalHandle: "profile-reader",
                profile: {
                    id: "user_profile_reads",
                    handle: "profile-reader",
                    canonicalPath: "/profiles/@profile-reader",
                },
            },
            partialHandle: null,
            missingId: null,
            noPicture: { profile: { picture: null } },
        });
    });

    it("paginates only the wallpapers owned by a Profile", async () => {
        const timestamp = "2026-03-01T00:00:00.000Z";
        await container.resolve(ProfileRepository).project({
            id: "user_profile_wallpapers",
            displayName: "Wallpaper Owner",
            handle: "wallpaper-owner",
            claimGeneration: 1,
            biographyMarkdown: "",
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
        });

        const wallpaperRepository = container.resolve(WallpaperRepository);
        for (const [wallpaperId, userId] of [
            ["wlpr_profile_001", "user_profile_wallpapers"],
            ["wlpr_profile_002", "user_profile_wallpapers"],
            ["wlpr_profile_003", "user_profile_wallpapers"],
            ["wlpr_other_profile", "user_other_profile"],
        ]) {
            await wallpaperRepository.upsert({
                wallpaperId,
                userId,
                variants: [],
                uploadedAt: timestamp,
                updatedAt: timestamp,
            });
        }

        const firstPage = await query(`
            query {
                profile(id: "user_profile_wallpapers") {
                    wallpapers(first: 2) {
                        edges { node { wallpaperId profileId } }
                        pageInfo { hasNextPage endCursor }
                    }
                }
            }
        `);

        expect(firstPage.errors).toBeUndefined();
        expect(firstPage.data.profile.wallpapers.edges).toEqual([
            { node: { wallpaperId: "wlpr_profile_001", profileId: "user_profile_wallpapers" } },
            { node: { wallpaperId: "wlpr_profile_002", profileId: "user_profile_wallpapers" } },
        ]);
        expect(firstPage.data.profile.wallpapers.pageInfo.hasNextPage).toBe(true);

        const secondPage = await query(`
            query {
                profile(id: "user_profile_wallpapers") {
                    wallpapers(first: 2, after: "${firstPage.data.profile.wallpapers.pageInfo.endCursor}") {
                        edges { node { wallpaperId profileId } }
                        pageInfo { hasNextPage hasPreviousPage }
                    }
                }
            }
        `);

        expect(secondPage.errors).toBeUndefined();
        expect(secondPage.data.profile.wallpapers).toEqual({
            edges: [
                { node: { wallpaperId: "wlpr_profile_003", profileId: "user_profile_wallpapers" } },
            ],
            pageInfo: { hasNextPage: false, hasPreviousPage: true },
        });
    });

    it("batch-resolves nullable Profile relationships for wallpaper results", async () => {
        const timestamp = "2026-03-02T00:00:00.000Z";
        const profileRepository = container.resolve(ProfileRepository);
        for (const [id, handle] of [
            ["user_profile_batch_a", "batch-a"],
            ["user_profile_batch_b", "batch-b"],
        ]) {
            await profileRepository.project({
                id,
                displayName: handle,
                handle,
                claimGeneration: 1,
                biographyMarkdown: "",
                pictureAssetId: null,
                version: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
            });
        }

        const wallpaperRepository = container.resolve(WallpaperRepository);
        for (const [wallpaperId, userId] of [
            ["wlpr_batch_001", "user_profile_batch_a"],
            ["wlpr_batch_002", "user_profile_batch_a"],
            ["wlpr_batch_003", "user_profile_batch_b"],
            ["wlpr_batch_004", "user_profile_missing"],
        ]) {
            await wallpaperRepository.upsert({
                wallpaperId,
                userId,
                variants: [],
                uploadedAt: timestamp,
                updatedAt: timestamp,
            });
        }

        const findByIds = vi.spyOn(profileRepository, "findByIds");
        const result = await query(`
            query {
                searchWallpapers(first: 10) {
                    edges {
                        node {
                            wallpaperId
                            profileId
                            profile { id handle }
                        }
                    }
                }
            }
        `);

        expect(result.errors).toBeUndefined();
        expect(result.data.searchWallpapers.edges).toEqual([
            {
                node: {
                    wallpaperId: "wlpr_batch_001",
                    profileId: "user_profile_batch_a",
                    profile: { id: "user_profile_batch_a", handle: "batch-a" },
                },
            },
            {
                node: {
                    wallpaperId: "wlpr_batch_002",
                    profileId: "user_profile_batch_a",
                    profile: { id: "user_profile_batch_a", handle: "batch-a" },
                },
            },
            {
                node: {
                    wallpaperId: "wlpr_batch_003",
                    profileId: "user_profile_batch_b",
                    profile: { id: "user_profile_batch_b", handle: "batch-b" },
                },
            },
            {
                node: {
                    wallpaperId: "wlpr_batch_004",
                    profileId: "user_profile_missing",
                    profile: null,
                },
            },
        ]);
        expect(findByIds).toHaveBeenCalledTimes(1);
        expect(findByIds).toHaveBeenCalledWith([
            "user_profile_batch_a",
            "user_profile_batch_a",
            "user_profile_batch_b",
            "user_profile_missing",
        ]);
    });
});

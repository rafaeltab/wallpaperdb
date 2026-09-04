import "reflect-metadata";
import { PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT } from "@wallpaperdb/events";
import { container } from "tsyringe";
import { describe, expect, it } from "vitest";
import { ProfileRepository } from "../src/repositories/profile.repository.js";
import { tester } from "./setup.js";

interface ProfileSnapshot {
    id: string;
    displayName: string;
    handle: string;
    claimGeneration: number;
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
                            id
                            handle
                            canonicalPath
                        }
                        mixedCaseHandle: profileByHandle(handle: "Profile-Reader") {
                            id
                            handle
                            canonicalPath
                        }
                        partialHandle: profileByHandle(handle: "profile-read") { id }
                        missingId: profile(id: "user_profile_missing") { id }
                        noPicture: profileByHandle(handle: "no-picture") { picture { id } }
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
                id: "user_profile_reads",
                handle: "profile-reader",
                canonicalPath: "/profiles/@profile-reader",
            },
            mixedCaseHandle: {
                id: "user_profile_reads",
                handle: "profile-reader",
                canonicalPath: "/profiles/@profile-reader",
            },
            partialHandle: null,
            missingId: null,
            noPicture: { picture: null },
        });
    });
});

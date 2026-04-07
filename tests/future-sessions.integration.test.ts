import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import {
  authHeaderFor,
  createAcceptedFriendship,
  createBlock,
  createFutureSessionRecord,
  createUser,
} from "./helpers.js";

describe("Future session visibility and permissions", () => {
  it("lets the owner list all of their own posts regardless of visibility", async () => {
 
    const owner = await createUser({
      name: "Owner",
      email: "owner-self@example.com",
    });

    // create four posts with different visibility settings so the test proves
    // the owner path returns everything, not only the public records.
    const publicPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "public",
      location: "Public Spot",
    });
    const friendsPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "friends",
      location: "Friends Spot",
    });
    const privatePost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "private",
      location: "Private Spot",
    });
    const customPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "custom",
      allowedViewerIds: ["someone-else"],
      location: "Custom Spot",
    });

    // Request the owner's own list using their bearer token.
    const res = await request(app)
      .get("/future-sessions/list-posts")
      .set(authHeaderFor(owner.id, owner.email));

    // The owner should receive every post back, including the private and custom ones.
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(4);
    expect(res.body.posts.map((post: { id: string }) => post.id)).toEqual(
      expect.arrayContaining([
        publicPost.id,
        friendsPost.id,
        privatePost.id,
        customPost.id,
      ])
    );
  });

  it("shows a friend the public, friends-only, and explicitly allowed custom posts", async () => {
    // Create an owner and a friend because the route needs an accepted
    // friendship to expose 'friends' visibility records.
    const owner = await createUser({
      email: "owner-friend@example.com",
    });
    const friend = await createUser({
      email: "friend-viewer@example.com",
    });

    // Mark the relationship as accepted so the viewer qualifies as a friend.
    await createAcceptedFriendship(owner.id, friend.id);

    // Create one post for each important visibility branch.
    const publicPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "public",
      location: "Friend Can See Public",
    });
    const friendsPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "friends",
      location: "Friend Can See Friends",
    });
    const privatePost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "private",
      location: "Friend Cannot See Private",
    });
    const customPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "custom",
      allowedViewerIds: [friend.id],
      location: "Friend Can See Custom",
    });

    // Ask for the owners posts as the friend.
    const res = await request(app)
      .get(`/future-sessions/list-posts/${owner.id}`)
      .set(authHeaderFor(friend.id, friend.email));

    // The friend should see public, friends, and allowed custom posts,
    // but private posts should still stay hidden.
    expect(res.status).toBe(200);
    expect(res.body.posts.map((post: { id: string }) => post.id)).toEqual(
      expect.arrayContaining([publicPost.id, friendsPost.id, customPost.id])
    );
    expect(res.body.posts.map((post: { id: string }) => post.id)).not.toContain(
      privatePost.id
    );
    expect(res.body.posts).toHaveLength(3);
  });

  it("shows a stranger only public posts and custom posts they were explicitly granted", async () => {
    // Create an owner and a non-friend viewer because this test is about
    // the default visibility filtering without any friendship privileges.
    const owner = await createUser({
      email: "owner-stranger@example.com",
    });
    const stranger = await createUser({
      email: "stranger-viewer@example.com",
    });

    // creating more posts that cover the public, friends, private, allowed custom,
    // and denied custom branches for a non-friend viewer
    const publicPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "public",
    });
    await createFutureSessionRecord({
      userId: owner.id,
      visibility: "friends",
    });
    await createFutureSessionRecord({
      userId: owner.id,
      visibility: "private",
    });
    const allowedCustomPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "custom",
      allowedViewerIds: [stranger.id],
    });
    await createFutureSessionRecord({
      userId: owner.id,
      visibility: "custom",
      allowedViewerIds: ["different-viewer"],
    });

    // Request the owners posts as a stranger
    const res = await request(app)
      .get(`/future-sessions/list-posts/${owner.id}`)
      .set(authHeaderFor(stranger.id, stranger.email));

    // The stranger should only receive the public record and the custom
    // record where their user id was explicitly listed.
    expect(res.status).toBe(200);
    expect(res.body.posts.map((post: { id: string }) => post.id)).toEqual(
      expect.arrayContaining([publicPost.id, allowedCustomPost.id])
    );
    expect(res.body.posts).toHaveLength(2);
  });

  it("blocks a blocked user from listing another user's posts or commenting on them", async () => {
    // Create the owner and viewer because the blocked-user rules depend
    // on the relationship between two real accounts.
    const owner = await createUser({
      email: "owner-blocked@example.com",
    });
    const blockedViewer = await createUser({
      email: "blocked-viewer@example.com",
    });

    const publicPost = await createFutureSessionRecord({
      userId: owner.id,
      visibility: "public",
    });

    await createBlock(owner.id, blockedViewer.id);

    // Try to list the owners posts as the blocked viewer.
    const listRes = await request(app)
      .get(`/future-sessions/list-posts/${owner.id}`)
      .set(authHeaderFor(blockedViewer.id, blockedViewer.email));

    // The route should reject the request
    expect(listRes.status).toBe(403);
    expect(listRes.body.message).toBe("Not allowed to view posts");

    // Try to comment on a post that would otherwise be visible.
    const commentRes = await request(app)
      .post(`/future-sessions/${publicPost.id}/add-comment`)
      .set(authHeaderFor(blockedViewer.id, blockedViewer.email))
      .send({ body: "Looks windy" });

    // Comment creation should also be blocked because the viewer cannot
    // see the underlying post once a block exists.
    expect(commentRes.status).toBe(403);
    expect(commentRes.body.message).toBe("Not allowed to comment on this post");
  });

  it("blocks post listing when the target user's profile is private", async () => {
    // Private profiles should not leak their post list through a different
    // endpoint, even when some posts would otherwise be public.
    const owner = await createUser({
      email: "owner-private-profile@example.com",
      profileVisibility: "private",
    });
    const viewer = await createUser({
      email: "viewer-private-profile@example.com",
    });

    await createFutureSessionRecord({
      userId: owner.id,
      visibility: "public",
      location: "Should stay hidden",
    });

    const res = await request(app)
      .get(`/future-sessions/list-posts/${owner.id}`)
      .set(authHeaderFor(viewer.id, viewer.email));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Not allowed to view posts");
  });
});

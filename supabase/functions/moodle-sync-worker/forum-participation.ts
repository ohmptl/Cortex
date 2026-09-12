import { text } from "../_shared/moodle-values.ts";
import type { MoodleCall } from "./engine.ts";

type Row = Record<string, unknown>;

export type ForumParticipation = {
  completed: boolean;
  submittedAt: string | null;
  discussions: number;
  posts: number;
  replies: number;
};

const timestamp = (row: Row): number => {
  const value = Number(
    row.timecreated ??
      row.created ??
      row.timestart ??
      row.timemodified ??
      row.modified,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const authorId = (row: Row): string => {
  const author =
    row.author && typeof row.author === "object" ? (row.author as Row) : {};
  const user =
    row.user && typeof row.user === "object" ? (row.user as Row) : {};
  return text(row.userid ?? row.user_id ?? author.id ?? user.id);
};

const isReply = (post: Row): boolean =>
  post.hasparent === true || Number(post.parentid ?? post.parent ?? 0) > 0;

const requirement = (forum: Row, key: string): number => {
  const value = Number(forum[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/**
 * Evaluates only posts authored by the connected Moodle user. An empty, complete
 * snapshot is authoritative non-participation; API failures are handled by the caller.
 */
export function evaluateForumParticipation(input: {
  forum: Row;
  discussions: Row[];
  posts: Row[];
  userId: string;
}): ForumParticipation {
  const ownPosts = input.posts.filter(
    (post) => authorId(post) === input.userId,
  );
  const ownDiscussionIds = new Set(
    input.discussions
      .filter((discussion) => authorId(discussion) === input.userId)
      .map((discussion) => text(discussion.discussion ?? discussion.id))
      .filter(Boolean),
  );
  for (const post of ownPosts)
    if (!isReply(post))
      ownDiscussionIds.add(text(post.discussionid ?? post.discussion));

  const replies = ownPosts.filter(isReply).length;
  const postCount = ownPosts.length;
  const discussionCount = ownDiscussionIds.size;
  const requiredPosts = requirement(input.forum, "completionposts");
  const requiredDiscussions = requirement(input.forum, "completiondiscussions");
  const requiredReplies = requirement(input.forum, "completionreplies");
  const hasRequirements =
    requiredPosts + requiredDiscussions + requiredReplies > 0;
  const completed = hasRequirements
    ? postCount >= requiredPosts &&
      discussionCount >= requiredDiscussions &&
      replies >= requiredReplies
    : postCount > 0;
  const latest = ownPosts.reduce(
    (value, post) => Math.max(value, timestamp(post)),
    0,
  );

  return {
    completed,
    submittedAt: latest ? new Date(latest * 1000).toISOString() : null,
    discussions: discussionCount,
    posts: postCount,
    replies,
  };
}

export async function getForumParticipation(input: {
  call: MoodleCall;
  baseUrl: string;
  token: string;
  forum: Row;
  forumId: string;
  userId: string;
  capabilities: Set<string>;
}): Promise<ForumParticipation | null> {
  if (!input.capabilities.has("mod_forum_get_forum_discussions")) return null;
  const discussions: Row[] = [];
  for (let page = 0; page < 100; page++) {
    const response = await input.call<Row>(
      input.baseUrl,
      input.token,
      "mod_forum_get_forum_discussions",
      {
        forumid: input.forumId,
        sortorder: -1,
        page,
        perpage: 50,
      },
    );
    const batch = Array.isArray(response.discussions)
      ? (response.discussions as Row[])
      : [];
    discussions.push(...batch);
    if (batch.length < 50) break;
    if (page === 99)
      throw new Error("Forum discussion pagination exceeded 100 pages");
  }

  const posts: Row[] = [];
  if (input.capabilities.has("mod_forum_get_discussion_posts")) {
    for (const discussion of discussions) {
      const discussionId = text(discussion.discussion ?? discussion.id);
      if (!discussionId) continue;
      const response = await input.call<Row>(
        input.baseUrl,
        input.token,
        "mod_forum_get_discussion_posts",
        { discussionid: discussionId, sortby: "created", sortdirection: "ASC" },
      );
      if (!Array.isArray(response.posts))
        throw new Error("Invalid forum posts response");
      posts.push(...(response.posts as Row[]));
    }
  } else {
    // Discussion authorship proves a root post, but cannot prove replies by the user.
    for (const discussion of discussions)
      if (authorId(discussion) === input.userId)
        posts.push({
          userid: input.userId,
          discussionid: discussion.discussion ?? discussion.id,
          parentid: 0,
          created:
            discussion.created ??
            discussion.timestart ??
            discussion.timemodified,
        });
    if (requirement(input.forum, "completionreplies") > 0) return null;
  }
  return evaluateForumParticipation({
    forum: input.forum,
    discussions,
    posts,
    userId: input.userId,
  });
}

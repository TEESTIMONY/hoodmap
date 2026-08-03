"use client";

import { useState } from "react";
import { PostCard } from "@/components/feed/PostCard";
import { MiniConstellation } from "@/components/constellation/MiniConstellation";
import type { Person, Post } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const TABS = ["Posts", "Replies", "Constellation"] as const;
type Tab = (typeof TABS)[number];

export function ProfileTabs({ person, posts }: { person: Person; posts: Post[] }) {
  const [active, setActive] = useState<Tab>("Posts");

  return (
    <div className="mt-6">
      <div className="flex border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={cn(
              "relative px-4 py-3 text-sm transition",
              active === tab ? "text-ink" : "text-ink-faint hover:text-ink-muted",
            )}
          >
            {tab}
            {active === tab && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-lime to-moss" />
            )}
          </button>
        ))}
      </div>

      <div className="animate-fade-up">
        {active === "Posts" && (
          <div>
            {posts.length === 0 ? (
              <EmptyState label="No posts yet." />
            ) : (
              posts.map((post) => <PostCard key={post.id} post={post} author={person} />)
            )}
          </div>
        )}

        {active === "Replies" && <EmptyState label={`${person.name} hasn't replied to anything yet.`} />}

        {active === "Constellation" && (
          <div className="px-4 py-5 md:px-6">
            <p className="mb-3 text-sm text-ink-faint">
              {person.name}'s direct connections in the network.
            </p>
            <MiniConstellation centerId={person.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-4 py-10 text-center text-sm text-ink-faint md:px-6">{label}</div>;
}

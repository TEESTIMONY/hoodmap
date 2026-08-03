"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Coins, Lock, MessageCircle, Repeat2, Zap } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, TierChip } from "@/components/ui/Chip";
import type { Person, Post } from "@/lib/mock-data";
import { formatCompactNumber, timeAgo } from "@/lib/utils";

export function PostCard({ post, author }: { post: Post; author: Person }) {
  const [signaled, setSignaled] = useState(false);
  const [signals, setSignals] = useState(post.signals);
  const [burst, setBurst] = useState(0);

  function toggleSignal() {
    setSignaled((prev) => {
      const next = !prev;
      setSignals((s) => s + (next ? 1 : -1));
      if (next) setBurst((b) => b + 1);
      return next;
    });
  }

  return (
    <article className="border-b border-line px-4 py-5 transition hover:bg-white/[0.015] md:px-6">
      <div className="flex gap-3">
        <Link href={`/profile/${author.handle}`} className="shrink-0">
          <Avatar seed={author.colorSeed} name={author.name} tier={author.tier} size="md" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Link href={`/profile/${author.handle}`} className="font-medium text-ink hover:underline">
              {author.name}
            </Link>
            <span className="font-mono text-xs text-ink-faint">@{author.handle}</span>
            <TierChip tier={author.tier} className="ml-0.5" />
            <span className="text-ink-faint">·</span>
            <span className="text-xs text-ink-faint" suppressHydrationWarning>
              {timeAgo(post.createdAt)}
            </span>
          </div>

          <p className="mt-1.5 text-[15px] leading-relaxed text-ink/90">{post.body}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {post.channel && <Chip>#{post.channel}</Chip>}
            {post.gated && (
              <Chip icon={<Lock className="h-3 w-3" />} className="border-lime/30 text-lime-soft">
                Token-gated
              </Chip>
            )}
          </div>

          <div className="mt-3 flex max-w-md items-center justify-between text-ink-faint">
            <button className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition hover:text-moss-soft">
              <MessageCircle className="h-4 w-4 transition group-hover:scale-110" />
              {formatCompactNumber(post.replies)}
            </button>
            <button className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition hover:text-success">
              <Repeat2 className="h-4 w-4 transition group-hover:scale-110" />
              {formatCompactNumber(post.echoes)}
            </button>
            <button
              onClick={toggleSignal}
              className={`relative flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition ${
                signaled ? "text-lime-soft" : "hover:text-lime-soft"
              }`}
            >
              <motion.span
                key={burst}
                initial={signaled ? { scale: 0.6 } : false}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 12 }}
              >
                <Zap className={`h-4 w-4 ${signaled ? "fill-lime-soft" : ""}`} />
              </motion.span>
              {formatCompactNumber(signals)}
            </button>
            <button className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition hover:text-warning">
              <Coins className="h-4 w-4 transition group-hover:scale-110" />
              Tip
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

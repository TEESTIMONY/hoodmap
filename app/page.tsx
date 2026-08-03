import { Composer } from "@/components/feed/Composer";
import { PostCard } from "@/components/feed/PostCard";
import { PulseWidget } from "@/components/feed/PulseWidget";
import { peopleById, posts } from "@/lib/mock-data";

export default function FeedPage() {
  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-6">
      <div className="min-w-0 flex-1 md:max-w-2xl">
        <div className="mb-4 animate-fade-up">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Feed</h1>
          <p className="text-sm text-ink-faint">What's moving across your network right now.</p>
        </div>

        <div className="glass-panel overflow-hidden rounded-2xl">
          <Composer />
          {posts.map((post) => {
            const author = peopleById.get(post.authorId);
            if (!author) return null;
            return <PostCard key={post.id} post={post} author={author} />;
          })}
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 lg:block">
        <div className="sticky top-20">
          <PulseWidget />
        </div>
      </aside>
    </div>
  );
}

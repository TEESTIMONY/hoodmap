import { notFound } from "next/navigation";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { findPerson, posts } from "@/lib/mock-data";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const person = findPerson(decodeURIComponent(handle));
  if (!person) notFound();

  const personPosts = posts.filter((p) => p.authorId === person.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
      <ProfileHeader person={person} />
      <ProfileTabs person={person} posts={personPosts} />
    </div>
  );
}

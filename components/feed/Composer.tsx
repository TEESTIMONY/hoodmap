"use client";

import { useState } from "react";
import { ImageIcon, Lock } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { peopleById } from "@/lib/mock-data";

export function Composer() {
  const [value, setValue] = useState("");
  const [gated, setGated] = useState(false);
  const me = peopleById.get("me")!;

  return (
    <div className="border-b border-line px-4 py-4 md:px-6">
      <div className="flex gap-3">
        <Avatar seed={me.colorSeed} name={me.name} tier={me.tier} size="md" />
        <div className="flex-1">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Share a signal with the network…"
            rows={2}
            className="w-full resize-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                disabled
                title="Coming soon"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint/50"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setGated((g) => !g)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition ${
                  gated
                    ? "bg-lime/15 text-lime-soft"
                    : "text-ink-faint hover:bg-white/[0.05] hover:text-ink-muted"
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                Token-gate
              </button>
            </div>
            <Button size="sm" disabled={!value.trim()} onClick={() => setValue("")}>
              Post
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

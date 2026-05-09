import type { TeamMeta } from "@/lib/awards";

export function TeamPill({ team }: { team: TeamMeta | undefined }) {
  if (!team) return null;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
      {team.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-white/10" />
      )}
      <span className="text-sm font-medium">{team.teamName}</span>
      <span className="text-xs text-white/50">@{team.displayName}</span>
    </div>
  );
}

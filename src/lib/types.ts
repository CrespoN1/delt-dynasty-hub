export type SleeperUser = {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string; avatar?: string } | null;
  avatar?: string | null;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  metadata?: Record<string, string> | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
  };
};

export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  starters: string[];
  starters_points?: number[];
  players: string[];
  players_points?: Record<string, number>;
  custom_points?: number | null;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  previous_league_id: string | null;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number | string>;
};

export type SleeperDraftPick = {
  draft_id: string;
  pick_no: number;
  round: number;
  roster_id: number | null;
  picked_by: string;
  player_id: string;
  metadata?: Record<string, string>;
  is_keeper?: boolean | null;
};

export type SleeperTransaction = {
  type: "trade" | "waiver" | "free_agent" | "commissioner";
  status: string;
  transaction_id: string;
  roster_ids: number[];
  consenter_ids?: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }>;
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }>;
  status_updated: number;
  created: number;
  leg: number;
};

export type PlayerSlim = {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
};

export type SeasonData = {
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  matchupsByWeek: Record<number, SleeperMatchup[]>;
  draftPicks: SleeperDraftPick[];
  transactions: SleeperTransaction[];
};

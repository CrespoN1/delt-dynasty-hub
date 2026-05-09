// Tiny GitHub Contents API wrapper — just what the cron needs to commit one file.

const API = "https://api.github.com";

type FileExists = { sha: string };

export async function getFileSha({
  owner,
  repo,
  path,
  branch,
  token,
}: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
}): Promise<FileExists | null> {
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getContents ${path} -> ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { sha: string };
  return { sha: j.sha };
}

export async function commitFile({
  owner,
  repo,
  path,
  branch,
  content,
  message,
  token,
  sha,
}: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  content: string;
  message: string;
  token: string;
  sha?: string;
}): Promise<{ commitSha: string }> {
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub putContents ${path} -> ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { commit: { sha: string } };
  return { commitSha: j.commit.sha };
}

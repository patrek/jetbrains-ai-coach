/*
 * Ported SDLC + community-catalog extension methods (ADR 0009 "Port (part 6)").
 *
 * Upstream serves these from the VS Code-coupled `panel-request-service.ts`. They
 * are genuinely filesystem/network-only — the only `vscode` use is
 * `vscode.workspace.fs` for the two install writes, which map cleanly to Node
 * `fs`. Everything else (session scans, git-config reads, the catalog fetch) is
 * already portable. We re-derive them here as `SidecarHandler`s so the bridge can
 * forward the Skills and SDLC pages' requests, completing the disposition table.
 *
 * The install writes reuse the upstream path guard (`safeJoinUnder`) unchanged,
 * so a hostile filename can never escape `~/.agents/{skills,agents}`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SidecarHandler } from './rpc-handlers';
import { errorResult, isRecord, isString, safeJoinUnder } from '../vendor/webview/panel-shared';
import { validateDateFilter } from '../vendor/webview/panel-rpc';
import { getCatalogItems } from '../vendor/webview/panel-catalog';
import { readTextWithByteLimit } from '../vendor/webview/fetch-utils';
import { fileUriToPath } from '../vendor/core/helpers';
import { readFileSafe } from '../vendor/core/parser-shared';
import type { Workspace } from '../vendor/core/types';

const CATALOG_MAX_BYTES = 1024 * 1024;

function homeDir(): string | undefined {
  return os.homedir() || undefined;
}

/* ---- getSdlcToolAnalysis (MCP-tool usage derived from parsed sessions) ---- */

const SDLC_SERVER_MAP: Record<string, { label: string; category: string }> = {
  github: { label: 'GitHub', category: 'Source Control' },
  atlassian: { label: 'Atlassian (Jira/Confluence)', category: 'Project Management' },
  jira: { label: 'Jira', category: 'Project Management' },
  'azure-devops': { label: 'Azure DevOps', category: 'DevOps' },
  azuredevops: { label: 'Azure DevOps', category: 'DevOps' },
  azure_mcp: { label: 'Azure', category: 'Cloud' },
  linear: { label: 'Linear', category: 'Project Management' },
  slack: { label: 'Slack', category: 'Communication' },
  sentry: { label: 'Sentry', category: 'Error Tracking' },
  datadog: { label: 'Datadog', category: 'Monitoring' },
  playwright: { label: 'Playwright', category: 'Testing' },
  docker: { label: 'Docker', category: 'Containers' },
  kubernetes: { label: 'Kubernetes', category: 'Containers' },
  postgres: { label: 'PostgreSQL', category: 'Database' },
  mysql: { label: 'MySQL', category: 'Database' },
  supabase: { label: 'Supabase', category: 'Backend' },
  vercel: { label: 'Vercel', category: 'Deployment' },
  netlify: { label: 'Netlify', category: 'Deployment' },
  figma: { label: 'Figma', category: 'Design' },
  notion: { label: 'Notion', category: 'Documentation' },
  confluence: { label: 'Confluence', category: 'Documentation' },
  grafana: { label: 'Grafana', category: 'Monitoring' },
  pagerduty: { label: 'PagerDuty', category: 'Incident Management' },
  snyk: { label: 'Snyk', category: 'Security' },
  sonarqube: { label: 'SonarQube', category: 'Code Quality' },
  circleci: { label: 'CircleCI', category: 'CI/CD' },
  jenkins: { label: 'Jenkins', category: 'CI/CD' },
  terraform: { label: 'Terraform', category: 'Infrastructure' },
  pulumi: { label: 'Pulumi', category: 'Infrastructure' },
  mslearnmcp: { label: 'Microsoft Learn', category: 'Documentation' },
};

function matchesWorkspace(session: { workspaceId: string; workspaceName: string }, workspaceId?: string): boolean {
  if (!workspaceId) return true;
  return session.workspaceId === workspaceId || session.workspaceName === workspaceId;
}

const getSdlcToolAnalysis: SidecarHandler = (ctx) => {
  const filter = isRecord(ctx.params?.filter) ? validateDateFilter(ctx.params.filter) : undefined;

  const filtered = ctx.parseResult.sessions.filter((session) => {
    if (!matchesWorkspace(session, filter?.workspaceId)) return false;
    if (filter?.harness && session.harness !== filter.harness) return false;
    return true;
  });

  const counts = new Map<string, number>();
  for (const session of filtered) {
    for (const request of session.requests) {
      for (const tool of request.toolsUsed) {
        if (!tool.startsWith('mcp_')) continue;
        const rest = tool.slice(4);
        const underscoreIdx = rest.indexOf('_');
        const serverId = underscoreIdx > 0 ? rest.slice(0, underscoreIdx) : rest;
        counts.set(serverId, (counts.get(serverId) || 0) + 1);
      }
    }
  }

  const mcpServers = [...counts.entries()]
    .map(([id, toolCalls]) => {
      const info = SDLC_SERVER_MAP[id];
      return { id, label: info?.label || id, category: info?.category || 'Other', toolCalls, isSdlcRelevant: !!info };
    })
    .sort((a, b) => b.toolCalls - a.toolCalls);

  return { mcpServers };
};

/* ---- getSdlcRepoScan (git remote + .github layout, filesystem only) ---- */

// A faithful port of `panel-request-service.ts`'s PRIVATE `resolveWorkspaceRoot`
// (workspace.json -> workspace.yaml -> package.json). This is intentionally NOT
// the core `config-health-helpers.resolveWorkspaceRoot(id, ws)`, which resolves
// roots by a different heuristic — using it would change the scan results.
function resolveWorkspaceRoot(workspace: Workspace): string | null {
  const wsJson = path.join(workspace.path, 'workspace.json');
  try {
    const content = readFileSafe(wsJson);
    const parsed: unknown = content ? JSON.parse(content) : undefined;
    if (isRecord(parsed)) {
      const raw = isString(parsed.folder) ? parsed.folder : isString(parsed.workspace) ? parsed.workspace : '';
      const decoded = fileUriToPath(raw).replace(/\/+$/, '');
      if (decoded && fs.existsSync(decoded)) return decoded;
    }
  } catch { /* fall through */ }

  try {
    const yamlText = fs.readFileSync(path.join(workspace.path, 'workspace.yaml'), 'utf-8');
    const folderMatch = yamlText.match(/folder:\s*['"]?([^'"\n]+)/);
    if (folderMatch) {
      const decoded = fileUriToPath(folderMatch[1]).replace(/\/+$/, '');
      if (fs.existsSync(decoded)) return decoded;
    }
  } catch { /* fall through */ }

  if (fs.existsSync(path.join(workspace.path, 'package.json'))) return workspace.path;
  return null;
}

function readDirEntries(dirPath: string, include: (entry: string) => boolean, mapEntry: (entry: string) => string = (e) => e): string[] {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
    return fs.readdirSync(dirPath).filter(include).map(mapEntry);
  } catch {
    return [];
  }
}

function getGitHubRemote(rootPath: string): string | null {
  try {
    const gitConfig = fs.readFileSync(path.join(rootPath, '.git', 'config'), 'utf-8');
    const match = gitConfig.match(/url\s*=\s*(?:https?:\/\/github\.com\/|git@github\.com:)([^/\s]+\/[^/\s.]+)/);
    return match ? match[1].replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

function scanWorkspaceRepo(workspaceName: string, rootPath: string): {
  workspace: string;
  remote: string | null;
  contextFiles: string[];
  workflows: string[];
  agenticWorkflows: string[];
} {
  const isYamlOrMd = (e: string) => e.endsWith('.yml') || e.endsWith('.yaml') || e.endsWith('.md');
  const isYaml = (e: string) => e.endsWith('.yml') || e.endsWith('.yaml');

  const contextFiles = readDirEntries(path.join(rootPath, '.github', 'agents'), isYamlOrMd, (e) => `agents/${e}`);
  if (fs.existsSync(path.join(rootPath, '.github', 'copilot-setup-steps.yml'))) contextFiles.push('copilot-setup-steps.yml');
  if (fs.existsSync(path.join(rootPath, '.github', 'copilot-instructions.md'))) contextFiles.push('copilot-instructions.md');

  return {
    workspace: workspaceName,
    remote: getGitHubRemote(rootPath),
    contextFiles,
    workflows: readDirEntries(path.join(rootPath, '.github', 'workflows'), isYaml),
    agenticWorkflows: readDirEntries(path.join(rootPath, '.github', 'aw'), isYamlOrMd),
  };
}

const getSdlcRepoScan: SidecarHandler = (ctx) => {
  const activity = new Map<string, number>();
  for (const session of ctx.parseResult.sessions) {
    const ts = session.lastMessageDate || session.creationDate || 0;
    if (ts > (activity.get(session.workspaceId) || 0)) activity.set(session.workspaceId, ts);
  }

  const roots: Array<{ workspaceId: string; workspaceName: string; rootPath: string }> = [];
  for (const workspace of ctx.parseResult.workspaces.values()) {
    const rootPath = resolveWorkspaceRoot(workspace);
    if (rootPath) roots.push({ workspaceId: workspace.id, workspaceName: workspace.name, rootPath });
  }

  roots.sort((a, b) => (activity.get(b.workspaceId) || 0) - (activity.get(a.workspaceId) || 0));
  const repos = roots.map((r) => scanWorkspaceRepo(r.workspaceName, r.rootPath));
  return { repos };
};

/* ---- discoverCatalog (remote community catalog fetch) ---- */

const discoverCatalog: SidecarHandler = async () => {
  try {
    const items = (await getCatalogItems()).map((item) => ({ ...item, relevanceScore: 0, matchReasons: [] }));
    return { items, totalScanned: items.length };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : 'Failed to fetch catalog');
  }
};

/* ---- installSkill / installCatalogItem (writes under ~/.agents) ---- */

const installSkill: SidecarHandler = async (ctx) => {
  const filename = isString(ctx.params?.filename) ? ctx.params.filename : '';
  const content = isString(ctx.params?.content) ? ctx.params.content : '';
  if (!filename || !content) return errorResult('Missing filename or content');

  const home = homeDir();
  if (!home) return errorResult('Cannot determine home directory');

  const targetPath = safeJoinUnder(path.join(home, '.agents', 'skills'), filename.split('/'), { allowedExts: ['.md'] });
  if (!targetPath) return errorResult('Invalid filename');

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    return { ok: true, path: targetPath };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : 'Install failed');
  }
};

const installCatalogItem: SidecarHandler = async (ctx) => {
  const catalogPath = isString(ctx.params?.path) ? ctx.params.path : '';
  const kind = isString(ctx.params?.kind) ? ctx.params.kind : 'skill';
  const title = isString(ctx.params?.title) ? ctx.params.title : '';
  // Reject a hostile catalog path BEFORE the network fetch (so attacker-controlled
  // path components never reach the remote URL). `safeJoinUnder` below is the
  // second guard on the write target — keep both; they protect different steps.
  if (!catalogPath || catalogPath.includes('..') || catalogPath.startsWith('/') || catalogPath.startsWith('\\')) {
    return errorResult('Invalid catalog path');
  }

  try {
    const rawUrl = `https://raw.githubusercontent.com/github/awesome-copilot/main/${catalogPath}`;
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.hostname !== 'raw.githubusercontent.com' || !parsedUrl.pathname.startsWith('/github/awesome-copilot/')) {
      return errorResult('Invalid catalog URL');
    }
    const response = await fetch(parsedUrl.toString(), { redirect: 'error' });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    const content = await readTextWithByteLimit(response, CATALOG_MAX_BYTES, 'Catalog item too large');

    const home = homeDir();
    if (!home) throw new Error('Cannot determine home directory');
    const subDir = kind === 'agent' ? 'agents' : 'skills';
    const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/-+/g, '-').replaceAll(/^-|-$/g, '');
    const filename = catalogPath.split('/').pop() || `${slug}.md`;

    const targetPath = safeJoinUnder(path.join(home, '.agents', subDir), [slug, filename], { allowedExts: ['.md'] });
    if (!targetPath) throw new Error('Invalid path');

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    return { content, filename: `${slug}/${filename}` };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : 'Install failed');
  }
};

/** The five ported SDLC/catalog handlers, keyed by RPC method name. */
export const SDLC_CATALOG_HANDLERS: Record<string, SidecarHandler> = {
  getSdlcToolAnalysis,
  getSdlcRepoScan,
  discoverCatalog,
  installSkill,
  installCatalogItem,
};

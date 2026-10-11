import type { Architecture, ArchEdge, ArchNode } from "../types";
import type { Manifest } from "./dependencies";

interface LayerDef {
  id: string;
  label: string;
  type: string;
  accent: string;
  patterns: RegExp;
}

const LAYERS: LayerDef[] = [
  {
    id: "frontend",
    label: "Frontend / UI",
    type: "frontend",
    accent: "#14b8a6",
    patterns:
      /(^|\/)(components?|pages?|views?|screens?|ui|layouts?|widgets?|containers?|hooks?|styles?|assets?|public)\//i,
  },
  {
    id: "routes",
    label: "Routes / Endpoints",
    type: "api",
    accent: "#0ea5e9",
    patterns: /(^|\/)(routes?|routers?|api|endpoints?|handlers?|resolvers?)\//i,
  },
  {
    id: "controllers",
    label: "Controllers",
    type: "controller",
    accent: "#06b6d4",
    patterns: /(^|\/)(controllers?|http|rest|graphql)\//i,
  },
  {
    id: "services",
    label: "Services / Domain",
    type: "service",
    accent: "#8b5cf6",
    patterns: /(^|\/)(services?|usecases?|use-cases?|domain|business|core|logic)\//i,
  },
  {
    id: "data",
    label: "Models / Repositories",
    type: "data",
    accent: "#f5a524",
    patterns:
      /(^|\/)(models?|repositor(y|ies)|dao|entities|entity|schemas?|migrations?|prisma|orm|store|stores)\//i,
  },
  {
    id: "auth",
    label: "Auth / Middleware",
    type: "auth",
    accent: "#e5484d",
    patterns: /(^|\/)(auth|authentication|authorization|middlewares?|guards?|permissions?|policies)\//i,
  },
  {
    id: "external",
    label: "External Integrations",
    type: "external",
    accent: "#f76808",
    patterns: /(^|\/)(integrations?|clients?|external|third[-_]?party|providers?|gateways?|adapters?)\//i,
  },
  {
    id: "config",
    label: "Configuration",
    type: "config",
    accent: "#64748b",
    patterns: /(^|\/)(config|configs|configuration|settings|env)\//i,
  },
  {
    id: "utils",
    label: "Shared Utilities",
    type: "util",
    accent: "#7e868c",
    patterns: /(^|\/)(utils?|lib|libs|helpers?|common|shared|tools?)\//i,
  },
  {
    id: "infra",
    label: "Infrastructure",
    type: "infra",
    accent: "#59616f",
    patterns:
      /(^|\/)(docker|k8s|kubernetes|terraform|\.github|scripts?|deploy|ci|infra)\//i,
  },
];

const TECH_SIGNATURES: { name: string; re: RegExp }[] = [
  { name: "React", re: /"react"\s*:/ },
  { name: "Next.js", re: /"next"\s*:/ },
  { name: "Vue", re: /"vue"\s*:/ },
  { name: "Nuxt", re: /"nuxt"\s*:/ },
  { name: "Svelte", re: /"svelte"\s*:/ },
  { name: "Angular", re: /"@angular\/core"\s*:/ },
  { name: "Express", re: /"express"\s*:/ },
  { name: "NestJS", re: /"@nestjs\/core"\s*:/ },
  { name: "Fastify", re: /"fastify"\s*:/ },
  { name: "Prisma", re: /"@prisma\/client"|"prisma"\s*:/ },
  { name: "TypeORM", re: /"typeorm"\s*:/ },
  { name: "Mongoose", re: /"mongoose"\s*:/ },
  { name: "Sequelize", re: /"sequelize"\s*:/ },
  { name: "PostgreSQL", re: /"pg"|"postgres"|psycopg2/i },
  { name: "MongoDB", re: /"mongodb"|pymongo/i },
  { name: "Redis", re: /"redis"|"ioredis"|redis-py/i },
  { name: "Tailwind CSS", re: /"tailwindcss"\s*:/ },
  { name: "Redux", re: /"@reduxjs\/toolkit"|"redux"\s*:/ },
  { name: "GraphQL", re: /"graphql"|"@apollo\/server"/ },
  { name: "Django", re: /^django/im },
  { name: "Flask", re: /^flask/im },
  { name: "FastAPI", re: /^fastapi/im },
  { name: "Spring", re: /spring-boot/ },
  { name: "Rails", re: /^rails/im },
  { name: "Laravel", re: /laravel\/framework/ },
  { name: "Docker", re: /FROM\s+\w+/ },
];

export function analyzeArchitecture(args: {
  allPaths: string[];
  manifests: Manifest[];
  sourceFiles: { path: string }[];
}): Architecture {
  const { allPaths, manifests } = args;

  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();

  for (const p of allPaths) {
    if (/(^|\/)(node_modules|\.git|dist|build|vendor)\//.test(p)) continue;
    for (const layer of LAYERS) {
      if (layer.patterns.test(p)) {
        counts.set(layer.id, (counts.get(layer.id) ?? 0) + 1);
        const list = samples.get(layer.id) ?? [];
        if (list.length < 4) list.push(p);
        samples.set(layer.id, list);
        break;
      }
    }
  }

  const nodes: ArchNode[] = [];
  for (const layer of LAYERS) {
    const files = counts.get(layer.id) ?? 0;
    if (!files) continue;
    nodes.push({
      id: layer.id,
      label: layer.label,
      type: layer.type,
      accent: layer.accent,
      files,
      detail: samples.get(layer.id)?.slice(0, 3).join("\n"),
    });
  }

  // Technology detection from manifests.
  const corpus = manifests.map((m) => m.content).join("\n");
  const tech = TECH_SIGNATURES.filter((t) => t.re.test(corpus)).map((t) => t.name);

  // If no layers were recognised at all, fall back to a flat single node.
  if (!nodes.length) {
    nodes.push({
      id: "app",
      label: "Application",
      type: "app",
      accent: "#14b8a6",
      files: allPaths.length,
      detail: allPaths.slice(0, 3).join("\n"),
    });
  }

  /* --- Edges: infer the conventional request flow -------------------- */
  const has = (id: string) => nodes.some((n) => n.id === id);
  const edges: ArchEdge[] = [];
  const link = (source: string, target: string, label?: string) => {
    if (has(source) && has(target) && source !== target) {
      edges.push({ id: `${source}-${target}`, source, target, label });
    }
  };

  link("frontend", "routes", "HTTP");
  link("frontend", "controllers", "calls");
  link("routes", "controllers", "dispatch");
  link("routes", "services", "invoke");
  link("controllers", "services", "invoke");
  link("services", "data", "persist");
  link("controllers", "data", "read/write");
  link("data", "external", "sync");
  link("services", "external", "call");
  link("routes", "auth", "guard");
  link("controllers", "auth", "guard");
  link("services", "utils", "uses");
  link("routes", "utils", "uses");
  link("frontend", "utils", "uses");
  link("config", "routes", "configures");
  link("config", "services", "configures");
  link("infra", "routes", "deploys");

  // Ensure at least one edge so the graph isn't a scatter of nodes.
  if (!edges.length && nodes.length > 1) {
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `${nodes[i].id}-${nodes[i + 1].id}`,
        source: nodes[i].id,
        target: nodes[i + 1].id,
      });
    }
  }

  const layers = nodes.map((n) => n.label);

  const summary = buildArchitectureSummary(nodes, tech);

  return { nodes, edges, layers, summary };
}

function buildArchitectureSummary(nodes: ArchNode[], tech: string[]): string {
  if (!nodes.length) return "The repository structure could not be classified into known layers.";

  const order = [
    "frontend", "routes", "controllers", "services", "data",
    "auth", "external", "config", "utils", "infra", "app",
  ];
  const present = order
    .map((id) => nodes.find((n) => n.id === id))
    .filter(Boolean) as ArchNode[];

  const flow = present.map((n) => n.label).join(" → ");
  const techPart = tech.length ? ` Built with ${tech.slice(0, 5).join(", ")}.` : "";
  return `${flow}.${techPart}`;
}

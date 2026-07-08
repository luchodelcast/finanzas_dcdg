/**
 * _lib/backlog.js — "Solicitudes de mejoras" desde la PWA (issue #78, Nocturno 7/7).
 *
 * Cada solicitud se convierte en un GitHub Issue con label `autobuild` para
 * que Autobuild (ver AUTOBUILD.md) la tome en una corrida futura. Reusa
 * GITHUB_TOKEN_FINANZAS + GITHUB_REPO_FINANZAS; si el token no está
 * configurado, las funciones lanzan un error claro que el handler traduce en
 * una respuesta (no un crash) — la funcionalidad queda lista y opera en
 * cuanto Luis ponga el token.
 */
import { config } from './env.js';

const GITHUB_API = 'https://api.github.com';

function requireGithubConfig() {
  const token = config.githubTokenFinanzas();
  if (!token) throw new Error('Configura GITHUB_TOKEN_FINANZAS (PAT con scope "repo") para poder crear/listar solicitudes de mejoras.');
  return { token, repo: config.githubRepoFinanzas() };
}

/** Arma el payload del issue de GitHub para una solicitud (función pura, sin red). */
export function armarPayloadSolicitud(texto) {
  const limpio = String(texto || '').trim();
  if (!limpio) throw new Error('Escribe qué te gustaría que el sistema pudiera hacer.');
  const titulo = limpio.length > 70 ? `${limpio.slice(0, 67)}…` : limpio;
  return {
    title: `[Solicitud] ${titulo}`,
    body: `${limpio}\n\n---\n🙋 Solicitud enviada desde la PWA (sección "Solicitudes de mejoras").`,
    labels: ['autobuild', 'enhancement'],
  };
}

/** Adapta issues crudos de la API de GitHub a la forma que usa la PWA (función pura, sin red). */
export function mapearIssuesGithub(rawIssues) {
  return (rawIssues || [])
    .filter((i) => !i.pull_request) // /issues de GitHub también devuelve PRs
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      created_at: i.created_at,
    }));
}

/** Crea el issue en GitHub para una solicitud de mejora nueva. */
export async function crearSolicitudMejora(texto) {
  const { token, repo } = requireGithubConfig();
  const payload = armarPayloadSolicitud(texto);
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`GitHub respondió ${res.status} al crear el issue.${detalle ? ' ' + detalle.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  return { number: data.number, url: data.html_url, title: data.title };
}

/** Lista las solicitudes/propuestas abiertas (issues con label `autobuild`). */
export async function listarSolicitudesAbiertas() {
  const { token, repo } = requireGithubConfig();
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues?state=open&labels=autobuild&per_page=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status} al listar los issues.`);
  return mapearIssuesGithub(await res.json());
}

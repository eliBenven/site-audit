/**
 * Dashboard — generates a self-contained HTML page for interactive auditing.
 *
 * The HTML embeds all CSS and JS inline so it can be served from a single
 * http.createServer handler with zero dependencies.
 */

export interface DashboardData {
  url: string;
  generatedAt: string;
  seo: {
    summary: { error: number; warning: number; info: number };
    pages: Array<{
      url: string;
      issues: Array<{ rule: string; severity: string; message: string }>;
    }>;
  };
  design: {
    overall: number;
    dimensions: Array<{ dimension: string; score: number; weight: number }>;
    topIssues: Array<{
      label: string;
      actual: string;
      score: number;
      deviations: string[];
    }>;
  } | null;
  rankedFixes: Array<{
    rank: number;
    title: string;
    impact: string;
    effort: string;
    category: string;
    details: string;
  }>;
  crawl: {
    totalPages: number;
    orphanPages: string[];
  };
}

export function generateDashboardHtml(data: DashboardData, port: number): string {
  const jsonBlob = JSON.stringify(data).replace(/<\//g, "<\\/");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Site Audit Dashboard — ${escapeHtml(data.url)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface-hover: #222636;
    --border: #2a2e3d;
    --text: #e4e6f0;
    --text-dim: #8b90a5;
    --green: #4ade80;
    --yellow: #fbbf24;
    --orange: #fb923c;
    --red: #f87171;
    --blue: #60a5fa;
    --purple: #a78bfa;
    --radius: 12px;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  header .url {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  header .meta {
    color: var(--text-dim);
    font-size: 0.8rem;
    text-align: right;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn:hover { background: var(--surface-hover); border-color: var(--blue); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .scores-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
  }

  .card h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 1rem;
  }

  /* Circular gauge */
  .gauge-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1rem 0;
  }

  .gauge {
    position: relative;
    width: 160px;
    height: 160px;
  }

  .gauge svg { transform: rotate(-90deg); }

  .gauge .score-label {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .gauge .score-label small {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* SEO summary */
  .seo-counts {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    margin: 1rem 0;
  }

  .seo-count {
    text-align: center;
  }

  .seo-count .num {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
  }

  .seo-count .label {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .seo-count.error .num { color: var(--red); }
  .seo-count.warning .num { color: var(--yellow); }
  .seo-count.info .num { color: var(--blue); }

  /* Dimension bars */
  .dim-list { list-style: none; }

  .dim-item {
    display: grid;
    grid-template-columns: 120px 1fr 50px;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .dim-item .dim-name {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-transform: capitalize;
  }

  .dim-bar-track {
    height: 8px;
    background: var(--bg);
    border-radius: 4px;
    overflow: hidden;
  }

  .dim-bar-fill {
    height: 100%;
    border-radius: 4px;
    width: 0%;
    transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .dim-item .dim-score {
    font-size: 0.85rem;
    font-weight: 600;
    text-align: right;
    font-family: var(--mono);
  }

  /* Fixes table */
  .fixes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .fixes-table th {
    text-align: left;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .fixes-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  .fixes-table tr:hover td { background: var(--surface-hover); }

  .fixes-table .rank { color: var(--text-dim); font-family: var(--mono); width: 40px; }
  .fixes-table .title { font-weight: 500; }
  .fixes-table .details { color: var(--text-dim); font-size: 0.8rem; margin-top: 0.25rem; }

  .tag {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tag.high { background: rgba(248,113,113,0.15); color: var(--red); }
  .tag.medium { background: rgba(251,191,36,0.15); color: var(--yellow); }
  .tag.low { background: rgba(96,165,250,0.15); color: var(--blue); }

  .tag.quick { background: rgba(74,222,128,0.15); color: var(--green); }
  .tag.moderate { background: rgba(251,191,36,0.15); color: var(--yellow); }
  .tag.significant { background: rgba(248,113,113,0.15); color: var(--red); }

  .crawl-stats {
    display: flex;
    gap: 2rem;
    margin: 0.5rem 0;
  }

  .crawl-stat {
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .crawl-stat strong {
    color: var(--text);
    font-family: var(--mono);
  }

  .section { margin-bottom: 2rem; }
  .section > h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    letter-spacing: -0.01em;
  }

  .spinner {
    display: none;
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--blue);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .btn.loading .spinner { display: inline-block; }
  .btn.loading .btn-text { display: none; }

  @keyframes spin { to { transform: rotate(360deg); } }

  .toast {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 1.25rem;
    font-size: 0.85rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    transform: translateY(100px);
    opacity: 0;
    transition: transform 0.3s, opacity 0.3s;
  }

  .toast.show { transform: translateY(0); opacity: 1; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>Site Audit Dashboard</h1>
      <div class="url">${escapeHtml(data.url)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:1rem;">
      <div class="meta">
        ${escapeHtml(data.generatedAt)}<br/>
        ${data.crawl.totalPages} pages crawled
      </div>
      <button class="btn" id="rerunBtn" onclick="rerunAudit()">
        <span class="spinner"></span>
        <span class="btn-text">Re-run</span>
      </button>
    </div>
  </header>

  <div class="scores-grid">
    ${data.design ? `
    <div class="card">
      <h2>Design Score</h2>
      <div class="gauge-wrap">
        <div class="gauge">
          <svg viewBox="0 0 160 160" width="160" height="160">
            <circle cx="80" cy="80" r="70" fill="none" stroke="var(--border)" stroke-width="10"/>
            <circle cx="80" cy="80" r="70" fill="none"
              stroke="${scoreColor(data.design.overall)}"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 70}"
              stroke-dashoffset="${2 * Math.PI * 70 * (1 - data.design.overall / 100)}"
              class="gauge-arc"/>
          </svg>
          <div class="score-label">
            ${data.design.overall}
            <small>out of 100</small>
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    <div class="card">
      <h2>SEO Health</h2>
      <div class="seo-counts">
        <div class="seo-count error">
          <div class="num">${data.seo.summary.error}</div>
          <div class="label">Errors</div>
        </div>
        <div class="seo-count warning">
          <div class="num">${data.seo.summary.warning}</div>
          <div class="label">Warnings</div>
        </div>
        <div class="seo-count info">
          <div class="num">${data.seo.summary.info}</div>
          <div class="label">Info</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Crawl Overview</h2>
      <div class="crawl-stats" style="flex-direction:column;gap:0.75rem;margin-top:0.5rem;">
        <div class="crawl-stat">Pages: <strong>${data.crawl.totalPages}</strong></div>
        <div class="crawl-stat">Orphan pages: <strong>${data.crawl.orphanPages.length}</strong></div>
        <div class="crawl-stat">SEO issues: <strong>${data.seo.summary.error + data.seo.summary.warning + data.seo.summary.info}</strong></div>
      </div>
    </div>
  </div>

  ${data.design ? `
  <div class="section">
    <h2>Design Dimensions</h2>
    <div class="card">
      <ul class="dim-list" id="dimList">
        ${data.design.dimensions.map(d => `
        <li class="dim-item">
          <span class="dim-name">${escapeHtml(d.dimension)}</span>
          <div class="dim-bar-track">
            <div class="dim-bar-fill" data-score="${d.score}" style="background:${scoreColor(d.score)};"></div>
          </div>
          <span class="dim-score" style="color:${scoreColor(d.score)}">${d.score}</span>
        </li>
        `).join('')}
      </ul>
    </div>
  </div>
  ` : ''}

  ${data.rankedFixes.length > 0 ? `
  <div class="section">
    <h2>Ranked Fixes</h2>
    <div class="card" style="padding:0;overflow:auto;">
      <table class="fixes-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Fix</th>
            <th>Impact</th>
            <th>Effort</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          ${data.rankedFixes.map(f => `
          <tr>
            <td class="rank">${f.rank}</td>
            <td>
              <div class="title">${escapeHtml(f.title)}</div>
              <div class="details">${escapeHtml(f.details)}</div>
            </td>
            <td><span class="tag ${f.impact}">${f.impact}</span></td>
            <td><span class="tag ${f.effort}">${f.effort}</span></td>
            <td>${escapeHtml(f.category)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
  ` : ''}
</div>

<div class="toast" id="toast"></div>

<script>
const AUDIT_DATA = ${jsonBlob};

// Animate dimension bars on load
document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    document.querySelectorAll('.dim-bar-fill').forEach(el => {
      const score = el.getAttribute('data-score');
      el.style.width = score + '%';
    });
  });
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function rerunAudit() {
  const btn = document.getElementById('rerunBtn');
  btn.classList.add('loading');
  btn.disabled = true;
  showToast('Re-running audit...');
  try {
    const res = await fetch('/rerun', { method: 'POST' });
    if (res.ok) {
      showToast('Audit complete. Reloading...');
      setTimeout(() => location.reload(), 500);
    } else {
      showToast('Re-run failed: ' + (await res.text()));
    }
  } catch (e) {
    showToast('Re-run failed: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreColor(score: number): string {
  if (score >= 95) return '#4ade80';
  if (score >= 75) return '#fbbf24';
  if (score >= 50) return '#fb923c';
  return '#f87171';
}

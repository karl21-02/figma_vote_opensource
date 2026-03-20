// ============================================================
// Figma Vote - Cloudflare Worker API
// ============================================================

export interface Env {
  VOTES: KVNamespace;
}

interface VoteOption {
  id: string;
  label: string;
  imageData?: string;
}

interface VoteSession {
  id: string;
  title: string;
  description: string;
  type: 'poll' | 'design' | 'reaction';
  options: VoteOption[];
  createdBy: string;
  createdAt: number;
  status: 'active' | 'closed';
}

interface VoteRecord {
  optionId: string;
  oderId: string;
  voterName: string;
  timestamp: number;
}

// --- Helpers ---

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

function json(data: any, status = 200): Response {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// --- KV Helpers ---

async function getSession(kv: KVNamespace, id: string): Promise<VoteSession | null> {
  const data = await kv.get(`session:${id}`, 'json');
  return data as VoteSession | null;
}

async function getVotes(kv: KVNamespace, sessionId: string): Promise<VoteRecord[]> {
  const data = await kv.get(`votes:${sessionId}`, 'json');
  return (data as VoteRecord[] | null) || [];
}

async function getSessionWithResults(kv: KVNamespace, id: string) {
  const session = await getSession(kv, id);
  if (!session) return null;

  const votes = await getVotes(kv, id);
  const options = session.options.map(opt => {
    const optVotes = votes.filter(v => v.optionId === opt.id);
    return {
      ...opt,
      voteCount: optVotes.length,
      voters: optVotes.map(v => v.voterName),
    };
  });

  return {
    ...session,
    options,
    totalVotes: votes.length,
  };
}

// --- Router ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // --- API Routes ---

    // Create session
    if (method === 'POST' && path === '/api/sessions') {
      const body = await request.json() as any;
      const { title, description, type: sessionType, options, createdBy } = body;

      if (!title || !options || options.length < 2) {
        return json({ error: '제목과 최소 2개의 옵션이 필요합니다.' }, 400);
      }

      const session: VoteSession = {
        id: generateId(),
        title,
        description: description || '',
        type: sessionType || 'poll',
        options: options.map((opt: any) => ({
          id: generateId(),
          label: opt.label,
          imageData: opt.imageData,
        })),
        createdBy: createdBy || 'Anonymous',
        createdAt: Date.now(),
        status: 'active',
      };

      await env.VOTES.put(`session:${session.id}`, JSON.stringify(session));
      await env.VOTES.put(`votes:${session.id}`, JSON.stringify([]));

      return json({ session, shareUrl: `${url.origin}/vote/${session.id}` });
    }

    // Get session
    if (method === 'GET' && path.match(/^\/api\/sessions\/[^/]+$/)) {
      const id = path.split('/')[3];
      const data = await getSessionWithResults(env.VOTES, id);
      if (!data) return json({ error: '투표를 찾을 수 없습니다.' }, 404);
      return json(data);
    }

    // Update session (close / reopen)
    if (method === 'PATCH' && path.match(/^\/api\/sessions\/[^/]+$/)) {
      const id = path.split('/')[3];
      const session = await getSession(env.VOTES, id);
      if (!session) return json({ error: '투표를 찾을 수 없습니다.' }, 404);

      const body = await request.json() as any;
      if (body.status) session.status = body.status;
      await env.VOTES.put(`session:${id}`, JSON.stringify(session));

      return json(session);
    }

    // Delete session
    if (method === 'DELETE' && path.match(/^\/api\/sessions\/[^/]+$/)) {
      const id = path.split('/')[3];
      await env.VOTES.delete(`session:${id}`);
      await env.VOTES.delete(`votes:${id}`);
      return json({ ok: true });
    }

    // Cast vote
    if (method === 'POST' && path.match(/^\/api\/sessions\/[^/]+\/vote$/)) {
      const id = path.split('/')[3];
      const session = await getSession(env.VOTES, id);
      if (!session) return json({ error: '투표를 찾을 수 없습니다.' }, 404);
      if (session.status === 'closed') return json({ error: '마감된 투표입니다.' }, 400);

      const body = await request.json() as any;
      const { optionId, voterId, voterName } = body;

      if (!optionId || !voterId) {
        return json({ error: 'optionId와 voterId가 필요합니다.' }, 400);
      }

      let votes = await getVotes(env.VOTES, id);
      // Remove previous vote
      votes = votes.filter(v => v.oderId !== voterId);
      // Add new vote
      votes.push({
        optionId,
        oderId: voterId,
        voterName: voterName || 'Anonymous',
        timestamp: Date.now(),
      });
      await env.VOTES.put(`votes:${id}`, JSON.stringify(votes));

      const data = await getSessionWithResults(env.VOTES, id);
      return json(data);
    }

    // Remove vote
    if (method === 'DELETE' && path.match(/^\/api\/sessions\/[^/]+\/vote$/)) {
      const id = path.split('/')[3];
      const body = await request.json() as any;
      const { voterId } = body;

      let votes = await getVotes(env.VOTES, id);
      votes = votes.filter(v => v.oderId !== voterId);
      await env.VOTES.put(`votes:${id}`, JSON.stringify(votes));

      const data = await getSessionWithResults(env.VOTES, id);
      return json(data);
    }

    // --- Vote Web Page ---
    if (method === 'GET' && path.match(/^\/vote\/[^/]+$/)) {
      const id = path.split('/')[2];
      const data = await getSessionWithResults(env.VOTES, id);
      if (!data) {
        return new Response('투표를 찾을 수 없습니다.', { status: 404 });
      }
      return new Response(renderVotePage(data, url.origin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Home
    if (path === '/') {
      return new Response('Figma Vote API is running.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return cors(new Response('Not Found', { status: 404 }));
  },
};

// --- Vote Page HTML ---

function renderVotePage(session: any, origin: string): string {
  const optionsHtml = session.options.map((opt: any) => {
    const pct = session.totalVotes > 0
      ? Math.round((opt.voteCount / session.totalVotes) * 100)
      : 0;
    const emoji = opt.label.match(/^[\p{Emoji}]/u);
    return `
      <div class="option" data-id="${opt.id}" onclick="vote('${opt.id}')">
        <div class="option-bar" style="width:${pct}%"></div>
        <div class="option-content">
          <div class="option-label">${escapeHtml(opt.label)}</div>
          <div class="option-stats">
            <span class="count">${opt.voteCount}</span>
            <span class="pct">${pct}%</span>
          </div>
        </div>
        ${opt.voters.length > 0 ? `<div class="voters">${opt.voters.map((v: string) => escapeHtml(v)).join(', ')}</div>` : ''}
      </div>
    `;
  }).join('');

  const statusBadge = session.status === 'closed'
    ? '<span class="badge closed">마감됨</span>'
    : '<span class="badge active">진행중</span>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(session.title)} - Figma Vote</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f8;color:#333;min-height:100vh;display:flex;justify-content:center;padding:20px}
.container{max-width:480px;width:100%}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.logo{font-size:12px;color:#999;text-align:center;margin-bottom:16px;letter-spacing:1px}
h1{font-size:20px;font-weight:700;margin-bottom:4px}
.desc{color:#666;font-size:14px;margin-bottom:8px}
.meta{display:flex;gap:12px;align-items:center;font-size:12px;color:#999;margin-bottom:20px}
.badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge.active{background:#e6f9ee;color:#1a7f37}
.badge.closed{background:#f0f0f0;color:#888}
.option{position:relative;border:2px solid #e5e5e5;border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:all .2s;overflow:hidden}
.option:hover{border-color:#0d99ff;transform:translateY(-1px);box-shadow:0 2px 8px rgba(13,153,255,.12)}
.option.selected{border-color:#0d99ff;background:rgba(13,153,255,.03)}
.option.disabled{opacity:.6;cursor:default;transform:none;box-shadow:none}
.option-bar{position:absolute;left:0;top:0;bottom:0;background:rgba(13,153,255,.08);transition:width .5s ease;border-radius:12px 0 0 12px}
.option-content{position:relative;display:flex;justify-content:space-between;align-items:center}
.option-label{font-weight:500;font-size:15px}
.option-stats{display:flex;gap:8px;font-size:13px;color:#888}
.count{font-weight:700;color:#333}
.voters{position:relative;font-size:11px;color:#999;margin-top:6px}
.name-input{margin-top:20px;padding:16px;background:#f7f7f8;border-radius:12px}
.name-input label{font-size:12px;font-weight:600;color:#666;display:block;margin-bottom:6px}
.name-input input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none;transition:border .2s}
.name-input input:focus{border-color:#0d99ff}
.total{text-align:center;margin-top:16px;font-size:13px;color:#999}
.footer{text-align:center;margin-top:16px;font-size:11px;color:#ccc}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}
</style>
</head>
<body>
<div class="container">
  <div class="logo">FIGMA VOTE</div>
  <div class="card">
    <h1>${escapeHtml(session.title)}</h1>
    ${session.description ? `<div class="desc">${escapeHtml(session.description)}</div>` : ''}
    <div class="meta">
      ${statusBadge}
      <span>by ${escapeHtml(session.createdBy)}</span>
    </div>
    <div id="options">${optionsHtml}</div>
    ${session.status !== 'closed' ? `
    <div class="name-input">
      <label>이름을 입력하세요</label>
      <input type="text" id="voter-name" placeholder="홍길동" maxlength="30">
    </div>` : ''}
    <div class="total">총 ${session.totalVotes}표</div>
  </div>
  <div class="footer">Powered by Figma Vote</div>
</div>
<div class="toast" id="toast"></div>
<script>
const SESSION_ID = '${session.id}';
const API = '${origin}/api/sessions/' + SESSION_ID;
const CLOSED = ${session.status === 'closed'};

(function() {
  const saved = localStorage.getItem('figma-vote-name');
  if (saved) {
    const input = document.getElementById('voter-name');
    if (input) input.value = saved;
  }
})();

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2500);
}

function vote(optionId) {
  if (CLOSED) { showToast('마감된 투표입니다.'); return; }
  var nameInput = document.getElementById('voter-name');
  var name = nameInput ? nameInput.value.trim() : '';
  if (!name) { showToast('이름을 입력해주세요.'); nameInput && nameInput.focus(); return; }
  localStorage.setItem('figma-vote-name', name);
  var voterId = 'web_' + name.replace(/\\s/g, '_');

  fetch(API + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: optionId, voterId: voterId, voterName: name })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { showToast(data.error); return; }
    showToast('투표 완료!');
    updateUI(data);
  })
  .catch(function() { showToast('오류가 발생했습니다.'); });
}

function updateUI(session) {
  var container = document.getElementById('options');
  container.innerHTML = session.options.map(function(opt) {
    var pct = session.totalVotes > 0 ? Math.round((opt.voteCount / session.totalVotes) * 100) : 0;
    return '<div class="option" data-id="' + opt.id + '" onclick="vote(\\'' + opt.id + '\\')">' +
      '<div class="option-bar" style="width:' + pct + '%"></div>' +
      '<div class="option-content">' +
      '<div class="option-label">' + escapeHtml(opt.label) + '</div>' +
      '<div class="option-stats"><span class="count">' + opt.voteCount + '</span><span class="pct">' + pct + '%</span></div>' +
      '</div>' +
      (opt.voters.length > 0 ? '<div class="voters">' + opt.voters.map(escapeHtml).join(', ') + '</div>' : '') +
      '</div>';
  }).join('');
  document.querySelector('.total').textContent = '총 ' + session.totalVotes + '표';
}

function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

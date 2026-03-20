// ============================================================
// Figma Vote Plugin - UI Code
// ============================================================

// --- Types ---

interface VoteOption {
  id: string;
  label: string;
  nodeId?: string;
  imageData?: string;
  voteCount?: number;
  voters?: string[];
}

interface VoteSession {
  id: string;
  title: string;
  description: string;
  type: 'poll' | 'design' | 'reaction';
  options: VoteOption[];
  createdBy: { id: string | null; name: string };
  createdAt: number;
  status: 'active' | 'closed';
  totalVotes?: number;
  userVotedOptionId?: string | null;
}

interface FrameInfo {
  nodeId: string;
  label: string;
  imageData: string | null;
}

// --- State ---

let currentView: 'home' | 'create' | 'vote' = 'home';
let sessions: VoteSession[] = [];
let currentSession: VoteSession | null = null;
let createType: 'poll' | 'design' | 'reaction' = 'poll';
let selectedFrames: FrameInfo[] = [];
let pollOptions: string[] = ['', ''];

const REACTION_PRESETS = [
  { emoji: '👍', label: '좋아요' },
  { emoji: '👎', label: '별로예요' },
  { emoji: '❤️', label: '최고' },
  { emoji: '🤔', label: '고민' },
  { emoji: '🔥', label: '완벽' },
  { emoji: '💡', label: '아이디어' },
];

// --- Messaging ---

function postMessage(type: string, payload?: any) {
  parent.postMessage({ pluginMessage: { type, payload } }, '*');
}

window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  switch (msg.type) {
    case 'sessions-list':
      sessions = msg.payload;
      currentView = 'home';
      render();
      break;

    case 'session-data':
      currentSession = msg.payload;
      currentView = 'vote';
      render();
      break;

    case 'session-created':
      postMessage('get-sessions');
      break;

    case 'session-deleted':
    case 'reset-done':
      postMessage('get-sessions');
      break;

    case 'session-closed':
    case 'session-reopened':
      if (currentSession && currentSession.id === msg.payload.id) {
        postMessage('get-session', { sessionId: currentSession.id });
      } else {
        postMessage('get-sessions');
      }
      break;

    case 'selected-frames':
      selectedFrames = msg.payload;
      renderCreateView();
      break;

    case 'error':
      showToast(msg.payload);
      break;
  }
};

// --- Toast ---

function showToast(message: string) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 8px 16px; border-radius: 6px;
    font-size: 12px; z-index: 100; animation: fadeIn 0.2s;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- Render Engine ---

const app = document.getElementById('app')!;

function render() {
  switch (currentView) {
    case 'home':
      renderHomeView();
      break;
    case 'create':
      renderCreateView();
      break;
    case 'vote':
      renderVoteView();
      break;
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hour}:${min}`;
}

function typeName(type: string): string {
  switch (type) {
    case 'poll': return '설문';
    case 'design': return '디자인';
    case 'reaction': return '리액션';
    default: return type;
  }
}

function typeIcon(type: string): string {
  switch (type) {
    case 'poll': return '📊';
    case 'design': return '🎨';
    case 'reaction': return '👍';
    default: return '📊';
  }
}

// --- Home View ---

function renderHomeView() {
  const hasItems = sessions.length > 0;

  app.innerHTML = `
    <div class="header">
      <div class="header-title">📮 Figma Vote</div>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" id="btn-create">+ 새 투표</button>
      </div>
    </div>
    <div class="content">
      ${
        hasItems
          ? sessions
              .map(
                (s) => `
            <div class="session-card" data-id="${s.id}">
              <div class="session-card-header">
                <div class="session-card-title">${escapeHtml(s.title)}</div>
                <span class="session-card-badge ${s.status === 'closed' ? 'badge-closed' : `badge-${s.type}`}">
                  ${s.status === 'closed' ? '마감' : typeName(s.type)}
                </span>
              </div>
              <div class="session-card-meta">
                <span>${typeIcon(s.type)} ${s.options.length}개 항목</span>
                <span>🗳️ ${s.totalVotes || 0}표</span>
                <span>${formatDate(s.createdAt)}</span>
              </div>
            </div>
          `
              )
              .join('')
          : `
            <div class="empty-state">
              <div class="empty-state-icon">📮</div>
              <div>아직 투표가 없습니다</div>
              <div style="font-size:11px">새 투표를 만들어 팀원들과 의견을 나눠보세요</div>
              <button class="btn btn-primary mt-8" id="btn-create-empty">+ 새 투표 만들기</button>
            </div>
          `
      }
    </div>
  `;

  // Bind events
  document.getElementById('btn-create')?.addEventListener('click', () => {
    currentView = 'create';
    createType = 'poll';
    pollOptions = ['', ''];
    selectedFrames = [];
    render();
  });

  document.getElementById('btn-create-empty')?.addEventListener('click', () => {
    currentView = 'create';
    createType = 'poll';
    pollOptions = ['', ''];
    selectedFrames = [];
    render();
  });

  document.querySelectorAll('.session-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.id!;
      postMessage('get-session', { sessionId: id });
    });
  });
}

// --- Create View ---

function renderCreateView() {
  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="btn-back">← 돌아가기</button>
      <div class="header-title">새 투표</div>
      <div style="width:70px"></div>
    </div>
    <div class="content">
      <div class="form-group">
        <label class="form-label">제목</label>
        <input class="form-input" id="input-title" placeholder="투표 제목을 입력하세요" maxlength="100" />
      </div>

      <div class="form-group">
        <label class="form-label">설명 (선택)</label>
        <textarea class="form-textarea" id="input-desc" placeholder="투표에 대한 설명을 추가하세요" rows="2"></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">투표 유형</label>
        <div class="type-selector">
          <div class="type-option ${createType === 'poll' ? 'active' : ''}" data-type="poll">
            <div class="type-option-icon">📊</div>
            <div class="type-option-label">설문</div>
          </div>
          <div class="type-option ${createType === 'design' ? 'active' : ''}" data-type="design">
            <div class="type-option-icon">🎨</div>
            <div class="type-option-label">디자인</div>
          </div>
          <div class="type-option ${createType === 'reaction' ? 'active' : ''}" data-type="reaction">
            <div class="type-option-icon">👍</div>
            <div class="type-option-label">리액션</div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div id="type-content">
        ${renderCreateTypeContent()}
      </div>
    </div>
    <div class="actions-bar">
      <button class="btn btn-secondary" id="btn-cancel">취소</button>
      <button class="btn btn-primary" id="btn-submit">투표 만들기</button>
    </div>
  `;

  // Bind events
  document.getElementById('btn-back')?.addEventListener('click', goHome);
  document.getElementById('btn-cancel')?.addEventListener('click', goHome);
  document.getElementById('btn-submit')?.addEventListener('click', handleCreateSubmit);

  document.querySelectorAll('.type-option').forEach((el) => {
    el.addEventListener('click', () => {
      createType = (el as HTMLElement).dataset.type as any;
      selectedFrames = [];
      pollOptions = ['', ''];
      renderCreateView();
    });
  });

  bindCreateTypeEvents();
}

function renderCreateTypeContent(): string {
  switch (createType) {
    case 'poll':
      return `
        <div class="form-group">
          <label class="form-label">선택지</label>
          <div class="options-list" id="options-list">
            ${pollOptions
              .map(
                (opt, i) => `
              <div class="option-row">
                <input class="form-input poll-option-input" data-index="${i}"
                       placeholder="옵션 ${i + 1}" value="${escapeHtml(opt)}" />
                ${
                  pollOptions.length > 2
                    ? `<button class="option-remove" data-index="${i}">×</button>`
                    : ''
                }
              </div>
            `
              )
              .join('')}
          </div>
          ${
            pollOptions.length < 10
              ? `<button class="btn btn-ghost btn-sm mt-8" id="btn-add-option">+ 옵션 추가</button>`
              : ''
          }
        </div>
      `;

    case 'design':
      return `
        <div class="form-group">
          <label class="form-label">디자인 시안 선택</label>
          <p style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px;">
            캔버스에서 비교할 프레임을 선택한 후 아래 버튼을 눌러주세요.
          </p>
          <button class="btn btn-secondary btn-sm" id="btn-get-frames">
            🖼️ 선택된 프레임 가져오기
          </button>
          ${
            selectedFrames.length > 0
              ? `
            <div class="frames-grid mt-8">
              ${selectedFrames
                .map(
                  (f) => `
                <div class="frame-card selected">
                  ${f.imageData ? `<img src="${f.imageData}" alt="${escapeHtml(f.label)}" />` : '<div style="height:80px;background:var(--color-bg-secondary)"></div>'}
                  <div class="frame-card-label">${escapeHtml(f.label)}</div>
                </div>
              `
                )
                .join('')}
            </div>
            <p style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">
              ${selectedFrames.length}개의 프레임이 선택됨
            </p>
          `
              : ''
          }
        </div>
      `;

    case 'reaction':
      return `
        <div class="form-group">
          <label class="form-label">리액션 종류</label>
          <p style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px;">
            사용할 리액션이 자동으로 설정됩니다.
          </p>
          <div class="reaction-options">
            ${REACTION_PRESETS.map(
              (r) => `
              <div class="reaction-btn selected">
                <div class="reaction-emoji">${r.emoji}</div>
                <div class="reaction-label">${r.label}</div>
              </div>
            `
            ).join('')}
          </div>
        </div>
      `;
  }
}

function bindCreateTypeEvents() {
  // Poll options
  document.querySelectorAll('.poll-option-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.index!);
      pollOptions[idx] = (e.target as HTMLInputElement).value;
    });
  });

  document.querySelectorAll('.option-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.index!);
      pollOptions.splice(idx, 1);
      renderCreateView();
    });
  });

  document.getElementById('btn-add-option')?.addEventListener('click', () => {
    pollOptions.push('');
    renderCreateView();
  });

  // Design frames
  document.getElementById('btn-get-frames')?.addEventListener('click', () => {
    postMessage('get-selected-frames');
  });
}

function handleCreateSubmit() {
  const title = (document.getElementById('input-title') as HTMLInputElement)?.value.trim();
  const description = (document.getElementById('input-desc') as HTMLTextAreaElement)?.value.trim();

  if (!title) {
    showToast('제목을 입력해주세요.');
    return;
  }

  let options: { label: string; nodeId?: string; imageData?: string }[] = [];

  switch (createType) {
    case 'poll':
      options = pollOptions
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
        .map((o) => ({ label: o }));
      if (options.length < 2) {
        showToast('최소 2개의 옵션을 입력해주세요.');
        return;
      }
      break;

    case 'design':
      if (selectedFrames.length < 2) {
        showToast('최소 2개의 프레임을 선택해주세요.');
        return;
      }
      options = selectedFrames.map((f) => ({
        label: f.label,
        nodeId: f.nodeId,
        imageData: f.imageData || undefined,
      }));
      break;

    case 'reaction':
      options = REACTION_PRESETS.map((r) => ({
        label: `${r.emoji} ${r.label}`,
      }));
      break;
  }

  postMessage('create-session', {
    title,
    description,
    sessionType: createType,
    options,
  });
}

// --- Vote View ---

function renderVoteView() {
  if (!currentSession) return;
  const s = currentSession;
  const isCreator = true; // Anyone can manage for now
  const isClosed = s.status === 'closed';
  const totalVotes = s.totalVotes || 0;

  app.innerHTML = `
    <div class="header">
      <button class="back-btn" id="btn-back">← 목록</button>
      <div class="header-actions">
        ${
          isCreator
            ? `
          ${
            isClosed
              ? `<button class="btn btn-ghost btn-sm" id="btn-reopen">다시 열기</button>`
              : `<button class="btn btn-ghost btn-sm" id="btn-close">마감</button>`
          }
          <button class="btn btn-ghost btn-sm" id="btn-delete" style="color:var(--color-danger)">삭제</button>
        `
            : ''
        }
      </div>
    </div>
    <div class="content">
      <div class="vote-header">
        <div class="vote-title">${escapeHtml(s.title)}</div>
        ${s.description ? `<div class="vote-description">${escapeHtml(s.description)}</div>` : ''}
        <div class="vote-meta">
          <span class="vote-status">
            <span class="status-dot ${s.status}"></span>
            ${isClosed ? '마감됨' : '진행중'}
          </span>
          <span>🗳️ ${totalVotes}표</span>
          <span>${escapeHtml(s.createdBy.name)}</span>
        </div>
      </div>

      ${renderVoteContent(s)}

      ${renderVotersList(s)}
    </div>
    <div class="actions-bar">
      <button class="btn btn-secondary btn-full" id="btn-refresh">🔄 새로고침</button>
    </div>
  `;

  // Bind events
  document.getElementById('btn-back')?.addEventListener('click', goHome);
  document.getElementById('btn-close')?.addEventListener('click', () => {
    postMessage('close-session', { sessionId: s.id });
  });
  document.getElementById('btn-reopen')?.addEventListener('click', () => {
    postMessage('reopen-session', { sessionId: s.id });
  });
  document.getElementById('btn-delete')?.addEventListener('click', () => {
    if (confirm('이 투표를 삭제하시겠습니까?')) {
      postMessage('delete-session', { sessionId: s.id });
    }
  });
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    postMessage('get-session', { sessionId: s.id });
  });

  bindVoteEvents(s);
}

function renderVoteContent(s: VoteSession): string {
  if (s.type === 'reaction') {
    return renderReactionContent(s);
  }
  if (s.type === 'design') {
    return renderDesignContent(s);
  }
  return renderPollContent(s);
}

function renderPollContent(s: VoteSession): string {
  const totalVotes = s.totalVotes || 0;
  const isClosed = s.status === 'closed';

  return `
    <div class="vote-options">
      ${s.options
        .map((opt) => {
          const pct = totalVotes > 0 ? Math.round(((opt.voteCount || 0) / totalVotes) * 100) : 0;
          const isSelected = s.userVotedOptionId === opt.id;
          const showResults = totalVotes > 0;
          return `
          <div class="vote-option ${isSelected ? 'selected' : ''} ${isClosed ? 'disabled' : ''}"
               data-option-id="${opt.id}" ${!isClosed ? 'data-votable="true"' : ''}>
            ${showResults ? `<div class="vote-option-bar" style="width: ${pct}%"></div>` : ''}
            <div class="vote-option-content">
              <div class="vote-option-label">
                <div class="vote-option-check"></div>
                ${escapeHtml(opt.label)}
              </div>
              ${
                showResults
                  ? `
                <div class="vote-option-stats">
                  <span class="vote-option-count">${opt.voteCount || 0}</span>
                  <span class="vote-option-pct">${pct}%</span>
                </div>
              `
                  : ''
              }
            </div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

function renderDesignContent(s: VoteSession): string {
  const totalVotes = s.totalVotes || 0;
  const isClosed = s.status === 'closed';

  return `
    <div class="vote-options">
      ${s.options
        .map((opt) => {
          const pct = totalVotes > 0 ? Math.round(((opt.voteCount || 0) / totalVotes) * 100) : 0;
          const isSelected = s.userVotedOptionId === opt.id;
          return `
          <div class="vote-option vote-option-design ${isSelected ? 'selected' : ''} ${isClosed ? 'disabled' : ''}"
               data-option-id="${opt.id}" ${!isClosed ? 'data-votable="true"' : ''}
               ${opt.nodeId ? `data-node-id="${opt.nodeId}"` : ''}>
            ${opt.imageData ? `<img class="vote-option-thumbnail" src="${opt.imageData}" alt="${escapeHtml(opt.label)}" />` : ''}
            <div class="vote-option-footer">
              <div class="vote-option-label">
                <div class="vote-option-check"></div>
                ${escapeHtml(opt.label)}
              </div>
              <div class="vote-option-stats">
                <span class="vote-option-count">${opt.voteCount || 0}</span>
                <span class="vote-option-pct">${pct}%</span>
              </div>
            </div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

function renderReactionContent(s: VoteSession): string {
  const isClosed = s.status === 'closed';

  return `
    <div class="reaction-options">
      ${s.options
        .map((opt) => {
          const isSelected = s.userVotedOptionId === opt.id;
          const parts = opt.label.split(' ');
          const emoji = parts[0];
          const label = parts.slice(1).join(' ');
          return `
          <div class="reaction-btn ${isSelected ? 'selected' : ''} ${isClosed ? 'disabled' : ''}"
               data-option-id="${opt.id}" ${!isClosed ? 'data-votable="true"' : ''}>
            <div class="reaction-emoji">${emoji}</div>
            <div class="reaction-count">${opt.voteCount || 0}</div>
            <div class="reaction-label">${escapeHtml(label)}</div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}

function renderVotersList(s: VoteSession): string {
  const hasVoters = s.options.some((o) => (o.voters?.length || 0) > 0);
  if (!hasVoters) return '';

  return `
    <div class="voters-section">
      <div class="voters-title">투표 현황</div>
      ${s.options
        .filter((o) => (o.voters?.length || 0) > 0)
        .map(
          (opt) => `
          <div class="mb-8">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${escapeHtml(opt.label)}</div>
            ${(opt.voters || [])
              .map(
                (name) => `
              <div class="voter-item">
                <div class="voter-avatar">${name.charAt(0).toUpperCase()}</div>
                <span>${escapeHtml(name)}</span>
              </div>
            `
              )
              .join('')}
          </div>
        `
        )
        .join('')}
    </div>
  `;
}

function bindVoteEvents(s: VoteSession) {
  document.querySelectorAll('[data-votable="true"]').forEach((el) => {
    el.addEventListener('click', () => {
      const optionId = (el as HTMLElement).dataset.optionId!;
      if (s.userVotedOptionId === optionId) {
        // Toggle off
        postMessage('remove-vote', { sessionId: s.id });
      } else {
        postMessage('cast-vote', { sessionId: s.id, optionId });
      }
    });
  });

  // Design vote: click thumbnail to focus node
  document.querySelectorAll('[data-node-id]').forEach((el) => {
    const img = el.querySelector('.vote-option-thumbnail');
    if (img) {
      img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const nodeId = (el as HTMLElement).dataset.nodeId!;
        postMessage('focus-node', { nodeId });
      });
    }
  });
}

// --- Helpers ---

function goHome() {
  currentView = 'home';
  postMessage('get-sessions');
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---

postMessage('get-sessions');

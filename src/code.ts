// ============================================================
// Figma Vote Plugin - Main Code (runs in Figma sandbox)
// ============================================================

interface VoteOption {
  id: string;
  label: string;
  nodeId?: string;
  imageData?: string;
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
}

interface VoteRecord {
  sessionId: string;
  optionId: string;
  userId: string | null;
  userName: string;
  timestamp: number;
}

// --- Storage ---

function getSessions(): VoteSession[] {
  const raw = figma.root.getPluginData('vote_sessions');
  return raw ? JSON.parse(raw) : [];
}

function saveSessions(sessions: VoteSession[]): void {
  figma.root.setPluginData('vote_sessions', JSON.stringify(sessions));
}

function getVotes(): VoteRecord[] {
  const raw = figma.root.getPluginData('vote_records');
  return raw ? JSON.parse(raw) : [];
}

function saveVotes(votes: VoteRecord[]): void {
  figma.root.setPluginData('vote_records', JSON.stringify(votes));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function currentUser() {
  return {
    id: figma.currentUser?.id ?? null,
    name: figma.currentUser?.name ?? 'Anonymous',
  };
}

// --- Helpers ---

function getSessionWithResults(sessionId: string) {
  const sessions = getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  const allVotes = getVotes().filter((v) => v.sessionId === sessionId);
  const results = session.options.map((opt) => {
    const optVotes = allVotes.filter((v) => v.optionId === opt.id);
    return {
      ...opt,
      voteCount: optVotes.length,
      voters: optVotes.map((v) => v.userName),
    };
  });

  const user = currentUser();
  const userVote = allVotes.find((v) => v.userId === user.id);

  return {
    ...session,
    options: results,
    totalVotes: allVotes.length,
    userVotedOptionId: userVote?.optionId ?? null,
  };
}

// --- Export frame thumbnails ---

async function exportNodeThumbnail(nodeId: string): Promise<string | null> {
  try {
    const node = figma.getNodeById(nodeId);
    if (!node || !('exportAsync' in node)) return null;
    const bytes = await (node as SceneNode).exportAsync({
      format: 'PNG',
      constraint: { type: 'WIDTH', value: 300 },
    });
    // Convert to base64 data URI
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // We'll send raw bytes array and let UI convert
    return `data:image/png;base64,${figma.base64Encode(bytes)}`;
  } catch {
    return null;
  }
}

// --- Message Handling ---

figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; payload?: any }) => {
  const { type, payload } = msg;

  switch (type) {
    // ---- Sessions ----
    case 'get-sessions': {
      const sessions = getSessions();
      const votes = getVotes();
      const list = sessions.map((s) => ({
        ...s,
        totalVotes: votes.filter((v) => v.sessionId === s.id).length,
      }));
      figma.ui.postMessage({ type: 'sessions-list', payload: list });
      break;
    }

    case 'get-session': {
      const data = getSessionWithResults(payload.sessionId);
      if (data) {
        figma.ui.postMessage({ type: 'session-data', payload: data });
      } else {
        figma.ui.postMessage({
          type: 'error',
          payload: '투표를 찾을 수 없습니다.',
        });
      }
      break;
    }

    case 'create-session': {
      const { title, description, sessionType, options } = payload;
      const session: VoteSession = {
        id: generateId(),
        title,
        description: description || '',
        type: sessionType,
        options: options.map((opt: any) => ({
          id: generateId(),
          label: opt.label,
          nodeId: opt.nodeId,
          imageData: opt.imageData,
        })),
        createdBy: currentUser(),
        createdAt: Date.now(),
        status: 'active',
      };
      const sessions = getSessions();
      sessions.unshift(session);
      saveSessions(sessions);
      figma.ui.postMessage({ type: 'session-created', payload: session });
      figma.notify(`투표 "${title}" 이(가) 생성되었습니다.`);
      break;
    }

    case 'delete-session': {
      let sessions = getSessions();
      sessions = sessions.filter((s) => s.id !== payload.sessionId);
      saveSessions(sessions);
      let votes = getVotes();
      votes = votes.filter((v) => v.sessionId !== payload.sessionId);
      saveVotes(votes);
      figma.ui.postMessage({ type: 'session-deleted' });
      figma.notify('투표가 삭제되었습니다.');
      break;
    }

    case 'close-session': {
      const sessions = getSessions();
      const idx = sessions.findIndex((s) => s.id === payload.sessionId);
      if (idx !== -1) {
        sessions[idx].status = 'closed';
        saveSessions(sessions);
        figma.ui.postMessage({
          type: 'session-closed',
          payload: sessions[idx],
        });
        figma.notify('투표가 마감되었습니다.');
      }
      break;
    }

    case 'reopen-session': {
      const sessions = getSessions();
      const idx = sessions.findIndex((s) => s.id === payload.sessionId);
      if (idx !== -1) {
        sessions[idx].status = 'active';
        saveSessions(sessions);
        figma.ui.postMessage({
          type: 'session-reopened',
          payload: sessions[idx],
        });
        figma.notify('투표가 다시 열렸습니다.');
      }
      break;
    }

    // ---- Voting ----
    case 'cast-vote': {
      const { sessionId, optionId } = payload;
      const sessions = getSessions();
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) {
        figma.ui.postMessage({
          type: 'error',
          payload: '투표를 찾을 수 없습니다.',
        });
        break;
      }
      if (session.status === 'closed') {
        figma.ui.postMessage({
          type: 'error',
          payload: '이미 마감된 투표입니다.',
        });
        break;
      }

      const user = currentUser();
      let votes = getVotes();

      // Remove previous vote from this user for this session
      votes = votes.filter(
        (v) => !(v.sessionId === sessionId && v.userId === user.id)
      );

      // Add new vote
      votes.push({
        sessionId,
        optionId,
        userId: user.id,
        userName: user.name,
        timestamp: Date.now(),
      });
      saveVotes(votes);

      // Return updated session
      const data = getSessionWithResults(sessionId);
      figma.ui.postMessage({ type: 'session-data', payload: data });
      break;
    }

    case 'remove-vote': {
      const { sessionId } = payload;
      const user = currentUser();
      let votes = getVotes();
      votes = votes.filter(
        (v) => !(v.sessionId === sessionId && v.userId === user.id)
      );
      saveVotes(votes);
      const data = getSessionWithResults(sessionId);
      figma.ui.postMessage({ type: 'session-data', payload: data });
      break;
    }

    // ---- Frame Selection ----
    case 'get-selected-frames': {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({
          type: 'selected-frames',
          payload: [],
        });
        figma.notify('프레임을 선택해주세요.', { timeout: 2000 });
        break;
      }

      const frames: { nodeId: string; label: string; imageData: string | null }[] = [];
      for (const node of selection) {
        const imageData = await exportNodeThumbnail(node.id);
        frames.push({
          nodeId: node.id,
          label: node.name,
          imageData,
        });
      }
      figma.ui.postMessage({ type: 'selected-frames', payload: frames });
      break;
    }

    case 'focus-node': {
      const node = figma.getNodeById(payload.nodeId);
      if (node && 'x' in node) {
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
      }
      break;
    }

    case 'get-current-user': {
      figma.ui.postMessage({
        type: 'current-user',
        payload: currentUser(),
      });
      break;
    }

    case 'reset-all': {
      figma.root.setPluginData('vote_sessions', '');
      figma.root.setPluginData('vote_records', '');
      figma.ui.postMessage({ type: 'reset-done' });
      figma.notify('모든 투표 데이터가 초기화되었습니다.');
      break;
    }
  }
};
